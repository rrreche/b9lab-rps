pragma solidity >= 0.5.0 <0.6.0;


import "./Pausable.sol";
import "./Balances.sol";

contract RockPaperScissors is Pausable, Balances {

  enum Hand {NULL, ROCK, PAPER, SCISSORS}

  struct Game {
    Hand secondPlayerHand;
    uint88 timeout; // We make sure that secondPlayerHand, timeout and address are tightly packed, making it 32 bytes
    address secondPlayer;
    uint256 stake;
    uint256 deadline;
  }

  // The bytes32 key is a hash comprising the creator's hand for the game and a secret.
  // This way we save storage space, as we do not need to store the secret hand in Game's struct.
  mapping(bytes32 => Game) public games;

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
    uint256 deadline
  );

  event LogHandShown(
    address indexed sender,
    bytes32 indexed gameId,
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
    @dev: This function is the default callback for the contract.

    We do not want to accept any ether if not by the appropiate methods, so we revert by default
  */
  function() external {
    revert();
  }

  /*
    @dev: This function lets a player create a match. He / she must specify the challenged address
    and a hidden hand that will act as game ID (key to the mapping)

    @param secondPlayer address is the challenged player's address
    @param bytes32 hashedHand is a hash obtained by calling hashHand() that will act as key.

  */
  function createMatch(bytes32 hashedHand, uint88 timeoutInHours) public payable mustBeRunning mustBeAlive returns (bytes32) {
    require(hashedHand != bytes32(0), "Invalid hashed hand");
    require(timeoutInHours > 0, "Timeout must be at least 1 hour");
    uint256 deadline = now.add(uint256(timeoutInHours).mul(1 hours));
    require(games[hashedHand].deadline == 0, "Password used");

    uint256 stake = msg.value;

    games[hashedHand] = Game({
      secondPlayerHand: Hand.NULL,
      timeout: timeoutInHours,
      secondPlayer: address(0),
      deadline: deadline,
      stake: stake
    });

    emit LogMatchCreated(msg.sender, hashedHand, stake, deadline);
  }

  /*
    @dev: This function lets a player join the match

    @param firstPlayerHashedHand bytes32 is the game key
  */
  function acceptMatch(bytes32 firstPlayerHashedHand) public payable {
    uint256 deadline = games[firstPlayerHashedHand].deadline;
    require(deadline != 0, "Game does not exist");
    require(now < deadline, "Deadline passed");
    uint256 stake = games[firstPlayerHashedHand].stake;
    require(stake == msg.value, "Invalid stake");
    require(games[firstPlayerHashedHand].secondPlayer == address(0), "Match contested by another player");

    deadline = now.add(uint256(games[firstPlayerHashedHand].timeout).mul(1 hours));
    stake = stake.add(msg.value);

    games[firstPlayerHashedHand].secondPlayer = msg.sender;
    games[firstPlayerHashedHand].deadline = deadline;
    games[firstPlayerHashedHand].stake = stake;

    emit LogMatchAccepted(msg.sender, firstPlayerHashedHand, stake, deadline);

  }

  /*
    @dev: This function is the natural extension of acceptMatch(). In this function the second player
      reveals the hand he picked.

    @param firstPlayerHashedHand bytes32 is the game key
  */
  function showHand(bytes32 firstPlayerHashedHand, Hand secondPlayerClearHand) public {
    require(secondPlayerClearHand != Hand.NULL, "Invalid hand");
    require(games[firstPlayerHashedHand].secondPlayer == msg.sender, "Invalid player address");
    require(games[firstPlayerHashedHand].secondPlayerHand == Hand.NULL, "Cannot pick hand twice");
    uint256 deadline = games[firstPlayerHashedHand].deadline;
    require(now < deadline, "Deadline passed");

    deadline = now.add(uint256(games[firstPlayerHashedHand].timeout).mul(1 hours));

    games[firstPlayerHashedHand].secondPlayerHand = secondPlayerClearHand;
    games[firstPlayerHashedHand].deadline = deadline;

    emit LogHandShown(msg.sender, firstPlayerHashedHand, deadline, secondPlayerClearHand);

  }

  /*
    @dev: This function resolves a game, must be called by the game creator.

    @param hand Hand the weapon choice
    @param secret uint256 the secret used to hash the hand
  */
  function resolveMatch(Hand firstPlayerHand, uint256 secret) public {
    bytes32 hashedHand = hashHand(firstPlayerHand, secret);

    Hand secondPlayerHand = games[hashedHand].secondPlayerHand;
    require(secondPlayerHand != Hand.NULL, "Player two has not made a move yet");

    uint256 deadline = games[hashedHand].deadline;
    require(now < deadline, "Deadline passed");

    address secondPlayer = games[hashedHand].secondPlayer;
    uint256 stake = games[hashedHand].stake;
    uint256 firstPlayerWage;
    uint256 secondPlayerWage;
    address winner;

    if(firstPlayerHand == secondPlayerHand) { // Tie, we divide stake into two
      firstPlayerWage = stake.div(2);
    } else {
      // Explanation:
      // ROCK (1) => PAPER (2) => SCISSOR (3) => ROCK(1)
      // If player 1 is to the right of player 2, he wins. Otherwise, he loses.
      winner = uint8(firstPlayerHand)-1 == uint8(secondPlayerHand) % 3 ? msg.sender : secondPlayer;
      firstPlayerWage = msg.sender == winner ? stake : 0;
    }

    secondPlayerWage = stake.sub(firstPlayerWage); // Player 2 will get the remaining stake

    zeroOutGameEntry(hashedHand);

    emit LogMatchResolved(
      msg.sender,
      hashedHand,
      winner, // if 0, tie
      firstPlayerWage,
      secondPlayerWage
    );

    if(firstPlayerWage > 0)
      increaseBalance(msg.sender, firstPlayerWage);

    if(secondPlayerWage > 0)
      increaseBalance(secondPlayer, secondPlayerWage);

  }

  /*
    @dev: This function lets the second player of a game punish the creator for not revealing
    his / her hand.

    @param firstPlayerHashedHand the key to the game's mapping
  */
  function punish(bytes32 firstPlayerHashedHand) public {
    require(firstPlayerHashedHand != bytes32(0), "Invalid game key");
    require(games[firstPlayerHashedHand].secondPlayer == msg.sender, "Only second player can call this function");
    require(games[firstPlayerHashedHand].secondPlayerHand != Hand.NULL, "You have to show your hand before calling");
    require(games[firstPlayerHashedHand].deadline < now, "Deadline has not passed");

    uint256 stake = games[firstPlayerHashedHand].stake;

    zeroOutGameEntry(firstPlayerHashedHand);

    emit LogPunishCalled(msg.sender, firstPlayerHashedHand);

    if(stake > 0)
      increaseBalance(msg.sender, stake);
  }

  /*
    @dev: Lets the game's creator recover the stake after the timeout, and punish the second player if no hand
        was comitted

    @param hand Hand the weapon choice
    @param secret uint256 the secret used to hash the hand
  */
  function cancelGame(Hand firstPlayerHand, uint256 secret) public {
    bytes32 hashedHand = hashHand(firstPlayerHand, secret);

    uint256 stake = games[hashedHand].stake;
    // Does not make sense to cancel a game that has not stake. This allows us to filter
    // both non-existant games and finished games.
    require(stake > 0, "No stake");

    require(games[hashedHand].secondPlayerHand == Hand.NULL, "Cannot cancel, game is on");
    require(games[hashedHand].deadline < now, "Deadline has not passed");

    zeroOutGameEntry(hashedHand);

    emit LogCancelCalled(msg.sender, hashedHand);

    if(stake > 0)
      increaseBalance(msg.sender, stake);
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
    require(secret != 0, "Null secret");
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
    games[gameId].timeout = 0;

    // Added this to avoid a situation in which after a game has been resolved and zeroed-out,
    // a player could call acceptMatch() again. It would not have monetary impact as the stakes would
    // have been distributed, but it could pollute the events log.
    games[gameId].deadline = now;
  }

}
