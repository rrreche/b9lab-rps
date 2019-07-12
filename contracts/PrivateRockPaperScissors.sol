pragma solidity >= 0.5.0 <0.6.0;


import "./Pausable.sol";
import "./Balances.sol";

contract PrivateRockPaperScissors is Pausable, Balances {

  enum Hand {NULL, ROCK, PAPER, SCISSORS}

  struct Game {
    Hand secondPlayerHand;
    address secondPlayer;
    uint256 stake;
    uint256 deadline;
  }

  mapping(bytes32 => Game) games;

  event LogMatchCreated(
    address indexed sender,
    bytes32 indexed gameId,
    uint256 stake,
    uint256 deadline
  );

  event LogMatchAccepted(
    address indexed sender,
    bytes32 indexed gameId,
    uint256 stake,
    uint256 deadline,
    Hand hand
  );

  event LogMatchResolved(
    address indexed sender,
    bytes32 indexed gameId,
    address indexed winner,
    uint256 firstPlayerWage,
    uint256 secondPlayerWage
  );

  event LogPunishCalled(
    address indexed sender,
    bytes32 indexed gameId
  );

  event LogCancelCalled(
    address indexed sender,
    bytes32 indexed gameId
  );

  constructor(bool startPaused) Pausable(startPaused) public {}

  /*
    @dev: This function lets a player create a match. He / she must specify the challenged address
    and a hidden hand that will act as game ID (key to the mapping)

    @param secondPlayer address is the challenged player's address
    @param bytes32 hashedHand is a hash obtained by calling hashHand() that will act as key.

  */
  function createMatch(bytes32 hashedHand) public payable mustBeRunning mustBeAlive returns (bytes32) {
    uint256 deadline = now.add(1 days);
    require(games[hashedHand].deadline == 0, "Password used");

    uint256 stake = msg.value;

    // We need even values so that we can return the stake safely in resolveMatch()
    // and the total stake is perfectly divisible in 3 parts: creator's incentive, creator's stake,
    // and second player's stake.
    if(stake % 2 == 1){
      increaseBalance(msg.sender, 1);
      stake.sub(1);
    }

    games[hashedHand] = Game({
      secondPlayer: address(0),
      deadline: deadline,
      secondPlayerHand: Hand.NULL,
      stake: stake
    });

    emit LogMatchCreated(msg.sender, hashedHand, stake, deadline);
  }

  /*
    @dev: This function lets a player accept the match

    @param firstPlayerHashedHand bytes32 is the game key
    @param hand Hand the weapon choice
    @param secret uint256 the secret used to hash the hand
  */
  function acceptMatch(bytes32 firstPlayerHashedHand, Hand secondPlayerClearHand) public payable {
    uint256 deadline = games[firstPlayerHashedHand].deadline;
    require(deadline != 0, "Game does not exist");
    require(now < deadline, "Deadline passed");
    uint256 stake = games[firstPlayerHashedHand].stake;
    require(stake.div(2) == msg.value, "Invalid stake");
    require(secondPlayerClearHand != Hand.NULL, "Invalid hand");
    require(games[firstPlayerHashedHand].secondPlayer == address(0), "Match contested by another player");

    deadline = now.add(1 days);
    stake = stake.add(msg.value);

    games[firstPlayerHashedHand].secondPlayer = msg.sender;
    games[firstPlayerHashedHand].secondPlayerHand = secondPlayerClearHand;
    games[firstPlayerHashedHand].stake = stake;
    games[firstPlayerHashedHand].deadline = deadline;

    emit LogMatchAccepted(msg.sender, firstPlayerHashedHand, stake, deadline, secondPlayerClearHand);

  }

  /*
    @dev: This function resolves a game, must be called by the game creator.

    @param hand Hand the weapon choice
    @param secret uint256 the secret used to hash the hand
  */
  function resolveMatch(Hand firstPlayerHand, uint256 secret) public {
    bytes32 hashedHand = hashHand(firstPlayerHand, secret);
    address secondPlayer = games[hashedHand].secondPlayer;
    require(secondPlayer != address(0), "Player two has not joined yet");

    uint256 deadline = games[hashedHand].deadline;
    require(now < deadline, "Deadline passed");

    uint256 stake = games[hashedHand].stake;
    uint256 firstPlayerWage;
    uint256 secondPlayerWage;
    address winner;

    Hand secondPlayerHand = games[hashedHand].secondPlayerHand;

    if(firstPlayerHand == secondPlayerHand) { // Tie
      firstPlayerWage = (stake.div(3)).mul(2);
    } else {
      // Explanation:
      // ROCK (0) => PAPER (1) => SCISSOR (2) => ROCK (0)
      // If player 1 is to the right of player 2, he wins. Otherwise, he loses.
      winner = uint8(firstPlayerHand) == ((uint8(secondPlayerHand) + 1) % 3) ? msg.sender : secondPlayer;
      firstPlayerWage = msg.sender == winner ? stake : stake.div(3);
    }

    secondPlayerWage = stake.sub(firstPlayerWage);

    zeroOutGameEntry(hashedHand);

    emit LogMatchResolved(
      msg.sender,
      hashedHand,
      winner, // if 0, tie
      firstPlayerWage,
      secondPlayerWage
    );

    if(stake > 0)  { // If there was a pool, update the balances
      increaseBalance(secondPlayer, secondPlayerWage);
      msg.sender.transfer(firstPlayerWage);
    }
  }

  /*
    @dev: This function lets the second player of a game punish the creator for not revealing
    his / her hand.

    @param firstPlayerHashedHand the key to the game's mapping
  */
  function punish(bytes32 firstPlayerHashedHand) public {
    require(games[firstPlayerHashedHand].deadline <= now, "Deadline has not passed");
    require(games[firstPlayerHashedHand].secondPlayer == msg.sender);

    uint256 stake = games[firstPlayerHashedHand].stake;

    zeroOutGameEntry(firstPlayerHashedHand);

    emit LogPunishCalled(msg.sender, firstPlayerHashedHand);

    msg.sender.transfer(stake);
  }

  /*
    @dev: Lets the game's creator recover the stake after the timeout

    @param hand Hand the weapon choice
    @param secret uint256 the secret used to hash the hand
  */
  function cancelGame(Hand firstPlayerHand, uint256 secret) public {
    bytes32 hashedHand = hashHand(firstPlayerHand, secret);

    uint256 stake = games[hashedHand].stake;
    // Does not make sense to cancel a game that has not stake. This allows us to filter
    // both non-existant games and finished games.
    require(stake > 0, "No stake");

    require(games[hashedHand].deadline <= now, "Deadline has not passed");
    require(games[hashedHand].secondPlayerHand != Hand.NULL, "Cannot cancel, game is on");

    zeroOutGameEntry(hashedHand);

    emit LogCancelCalled(msg.sender, hashedHand);

    msg.sender.transfer(stake);
  }

  /*
    @dev: This function lets the user pick a hand and hash it with a random secret, generated off-chain.

    This also serves as key for the games mapping.

    We could optimize the storage costs by adding the challenged player to the hash,
    but this would mean that the hash ought to be shared out of band.

    @param hand Hand the weapon choice
    @param secret uint256 random secret to hide the hand
  */
  function hashHand(Hand hand, uint256 secret) public view returns (bytes32) {
    require(hand != Hand.NULL, "Null hand");
    return keccak256(abi.encodePacked(address(this), msg.sender, hand, secret));
  }

  /*
    @dev: This function zeroes out game entries and reduces world state

    @param gameId bytes32 the key to the mapping
  */
  function zeroOutGameEntry(bytes32 gameId) internal {
    games[gameId].secondPlayerHand = Hand.NULL;
    games[gameId].secondPlayer = address(0);
    games[gameId].stake = 0;
  }

  /*
    @dev: This function is the default callback for the contract.

    We do not want to accept any ether if not by the appropiate methods, so we revert by default
  */
  function() external {
    revert();
  }

}
