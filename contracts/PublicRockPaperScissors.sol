pragma solidity >= 0.5.0 <0.6.0;


import "./Pausable.sol";
import "./Balances.sol";

contract PublicRockPaperScissors is Pausable, Balances {

  struct Game {
    bytes32 firstPlayerHashedHand;
    bytes32 secondPlayerHashedHand;
    uint256 stake;
    uint256 deadline;
    address firstPlayer;
    address secondPlayer;
    Hand firstPlayerHand;
    Hand secondPlayerHand;
  }

  event LogMatchCreated(
    address indexed sender,
    uint256 indexed gameId,
    bytes32 firstPlayerHashedHand,
    uint256 deadline,
    uint256 stake
  );

  event LogMatchChallenged(
    address indexed sender,
    uint256 indexed gameId,
    bytes32 secondPlayerHashedHand,
    uint256 deadline,
    uint256 stake
  );

  event LogHandRevealed(
    address indexed sender,
    uint256 indexed gameId,
    Hand hand
  );

  event LogMatchResolved(
    address indexed sender,
    uint256 indexed gameId,
    address indexed winner
  );

  event LogMatchCancelled(
    address indexed sender,
    uint256 indexed gameId
  );

  event LogPunishment(
    address indexed sender,
    uint256 indexed gameId,
    address punished
  );

  enum Hand {NULL, ROCK, PAPER, SCISSORS}

  uint256 constant public _oneDayInSeconds = 1 days;
  uint256 public gameCount;

  mapping(uint256 => Game) public games;

  constructor(bool startPaused) Pausable(startPaused) public {}

  /*
    @dev: This function zeroes out game entries and reduces world state

    @param gameId uint256 the pointer to the game entry to be deleted
  */
  function zeroOutGameEntry(uint256 gameId) internal {
    games[gameId] = Game({
      firstPlayerHashedHand: bytes32(0),
      secondPlayerHashedHand: bytes32(0),
      stake: 0,
      deadline: 0,
      firstPlayer: address(0),
      secondPlayer: address(0),
      firstPlayerHand: Hand.NULL,
      secondPlayerHand: Hand.NULL
    });
  }

  /*
    @dev: This function lets the user pick a hand and hash it with a random secret, generated off-chain.

    The contract does not keep track of used secrets, so be careful.

    @param hand Hand the weapon choice
    @param secret uint256 random secret to hide the hand
  */
  function hashHand(Hand hand, uint256 secret) public view returns (bytes32) {
    require(hand != Hand.NULL, "Null hand");
    return keccak256(abi.encodePacked(address(this), msg.sender, hand, secret));
  }


  /*
    @dev: This function translates a hand to a number

    @param hand Hand the weapon choice
  */
  function handEnumToNumber(Hand hand) public pure returns (uint8) {
    require(hand != Hand.NULL);
    if(hand == Hand.ROCK)
      return 0;
    else if(hand == Hand.PAPER)
      return 1;
    else
      return 2;
  }

  /*
    @dev: This function updates a game's state to reveal the calling player's hand.

    @param gameId uint256 the id of the game
    @param hand Hand the weapon choice
    @param secret uint256 the random secret that was used to conceal the hand
  */
  function revealHand(uint256 gameId, Hand hand, uint256 secret) public returns (bool) {
    require(hand != Hand.NULL, "Cannot reveal a null hand");
    bytes32 secondPlayerHashedHand = games[gameId].secondPlayerHashedHand;
    require(secondPlayerHashedHand != bytes32(0), "Must wait for second player join"); // Very weak protection. Even if it fails, a second player could potentially spot it.
    bytes32 hashedHand = hashHand(hand, secret);

    if(msg.sender == games[gameId].firstPlayer) {
      require(hashedHand == games[gameId].firstPlayerHashedHand, "Hand or secret are incorrect"); // Correctly reveal secrets
      games[gameId].firstPlayerHand = hand;
    } else if(msg.sender == games[gameId].secondPlayer) {
      require(hashedHand == secondPlayerHashedHand, "Hand or secret are incorrect"); // Correctly reveal secrets
      games[gameId].secondPlayerHand = hand;
    } else {
      revert("You do not belong to this match");
    }

    emit LogHandRevealed(msg.sender, gameId, hand);

    return true;

  }

  /*
    @dev: This function bootstraps a public game: any player can challenge the creator.

    The game will be assigned an id (gameId) which is a autoincremented index (0, 1, 2...)

    Warning: the contract does not check duplicated hashed hands.

    @param firstPlayerHashedHand bytes32 the concealed hand choice, generated with hasHand()
  */
  function createMatch(bytes32 firstPlayerHashedHand) public payable mustBeRunning mustBeAlive returns (uint256) {
    // Deadline and stake
    uint256 deadline = now + _oneDayInSeconds; // The user can cancel the game after the deadline has passed, if uncontested
    uint256 stake;

    // Avoid odd values.
    if(msg.value % 2 == 0) {
      stake = msg.value;
    } else {
      stake = msg.value.sub(1);
      increaseBalance(msg.sender, 1);
    }

    uint256 gameId = gameCount;

    // Create game
    games[gameId] = Game({
      firstPlayerHashedHand: firstPlayerHashedHand,
      secondPlayerHashedHand: bytes32(0),
      stake: stake,
      deadline: deadline,
      firstPlayer: msg.sender,
      secondPlayer: address(0),
      firstPlayerHand: Hand.NULL,
      secondPlayerHand: Hand.NULL
    });

    gameCount = gameId.add(1);

    // Emit event
    emit LogMatchCreated(msg.sender, gameId, firstPlayerHashedHand, deadline, stake);

    return gameId;
  }

  /*
    @dev: This function allows a player to accept a public challenge.

    @param gameId uint256 the ID of the contested match
    @param secondPlayerHashedHand bytes32 the concealed hand choice, generated with hasHand()
  */
  function challengeMatch(uint256 gameId, bytes32 secondPlayerHashedHand) public payable returns (bool) {
    require(now < games[gameId].deadline, "Deadline has passed"); // Deadline has not passed && game exists && game has not been resolved
    require(games[gameId].secondPlayer == address(0), "This match is already contested"); // Can only challenge uncontested games
    require(msg.value == games[gameId].stake, "You must put the same stake as the opponent"); // Put the same stake as first player

    uint256 deadline = now + _oneDayInSeconds; // Add additional time for the other player to notice.
    uint256 stake = msg.value.mul(2); // if the player has put the same amount, then the total stake is doubled.

    games[gameId].secondPlayer = msg.sender;
    games[gameId].secondPlayerHashedHand = secondPlayerHashedHand;
    games[gameId].stake = stake;
    games[gameId].deadline = deadline;


    emit LogMatchChallenged(msg.sender, gameId, secondPlayerHashedHand, deadline, stake);

    return true;

  }

  /*
    @dev: This function resolves a game, logging the winner and assigning the wages.

    Anyone can resolve a game, so that if there is a community interested in keeping things running,
    they can take charge of the fees.

    @param gameId uint256 the ID of the contested match
  */
  function resolveMatch(uint256 gameId) public returns (bool) {
    require(games[gameId].firstPlayerHand != Hand.NULL && games[gameId].secondPlayerHand != Hand.NULL, "At least one hand has not been revealed yet"); // Game must be resolved

    address firstPlayer = games[gameId].firstPlayer;
    address secondPlayer = games[gameId].secondPlayer;

    uint256 firstPlayerHand = handEnumToNumber(games[gameId].firstPlayerHand);
    uint256 secondPlayerHand = handEnumToNumber(games[gameId].secondPlayerHand);

    address winner;

    if(firstPlayerHand != secondPlayerHand) {
      winner = firstPlayerHand == (secondPlayerHand + 1 % 3) ? firstPlayer : secondPlayer;
    }

    if(firstPlayerHand == secondPlayerHand) { // Tie
      winner = address(0);
    } else {
      // Explanation:
      // ROCK (0) => PAPER (1) => SCISSOR (2) => ROCK (0)
      // If player 1 is to the right of player 2, he wins. Otherwise, he loses.
      winner = firstPlayerHand == ((secondPlayerHand + 1) % 3) ? firstPlayer : secondPlayer;
    }

    uint256 stake = games[gameId].stake;

    if(stake > 0)  { // If there was a pool, update the balances
      if(winner == address(0)){
        uint256 wage = stake.div(2);
        increaseBalance(firstPlayer, wage);
        increaseBalance(secondPlayer, wage);
      } else {
        increaseBalance(winner, stake);
      }
    }

    zeroOutGameEntry(gameId);

    emit LogMatchResolved(msg.sender, gameId, winner);

    return true;
  }

  /*
    @dev: This function cancels a game if the deadline has passed and it was not contested.
    Returns the stake to the creator

    @param gameId uint256 the ID of the contested match
  */
  function cancelMatch(uint256 gameId) public returns (bool) {
    require(games[gameId].deadline < now); // Deadline has passed
    require(games[gameId].secondPlayerHashedHand == bytes32(0)); // The second player must be absent

    increaseBalance(games[gameId].firstPlayer, games[gameId].stake); // This will throw if the game had no stake.

    zeroOutGameEntry(gameId);

    emit LogMatchCancelled(msg.sender, gameId);

    return true;
  }

  /*
    @dev: This function punishes the players if they had comitted to a game but did not reveal in time.

    Even if there was no stake, a punishment is logged as (very weak) reputation system.

    @param gameId uint256 the ID of the contested match
  */
  function punish(uint256 gameId) public returns (bool) {
    require(games[gameId].deadline < now); // deadline has passed
    require(games[gameId].secondPlayerHashedHand != bytes32(0)); // The second player must have joined
    uint256 stake = games[gameId].stake;

    uint256 firstPlayerWage;
    uint256 secondPlayerWage;

    address firstPlayer = games[gameId].firstPlayer;
    address secondPlayer = games[gameId].secondPlayer;

    if(games[gameId].secondPlayerHand == Hand.NULL){
      firstPlayerWage = stake.div(2);
      emit LogPunishment(msg.sender, gameId, firstPlayer);
    }else{
      secondPlayerWage = stake.div(2);
    }

    if(games[gameId].firstPlayerHand == Hand.NULL){
      secondPlayerWage = stake.div(2);
      emit LogPunishment(msg.sender, gameId, secondPlayer);
    }else{
      firstPlayerWage = stake.div(2);
    }

    zeroOutGameEntry(gameId);

    if(firstPlayerWage > 0)
      increaseBalance(firstPlayer, firstPlayerWage);
    if(secondPlayerWage > 0)
      increaseBalance(secondPlayer, secondPlayerWage);

    return true;
  }

  function() external {
    revert();
  }

}
