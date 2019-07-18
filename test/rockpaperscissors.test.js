const RockPaperScissors = artifacts.require("./RockPaperScissors.sol");

const { BN, expectEvent, expectRevert, balance, time } = require("openzeppelin-test-helpers");
const { toWei, fromWei } = require("web3-utils");

const stake = new BN(toWei("1", "shannon"));

const zero_address = "0x0000000000000000000000000000000000000000";
const zero_bytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const zero_uint256 = new BN("0");

const NULL = zero_uint256;
const ROCK = new BN("1");
const PAPER = new BN("2");
const SCISSORS = new BN("3");
const secret = new BN("1234");
const timeoutInHours = new BN("1");

const gameIsZeroedOut = game => {
  game.stake.should.be.bignumber.equal(zero_uint256);
  game.secondPlayer.should.be.equal(zero_address);
  game.secondPlayerHand.should.be.bignumber.equal(zero_uint256);
  game.timeout.should.be.bignumber.equal(zero_uint256);
};

contract("RockPaperScissors", ([alice, bob, mallory, ...accounts]) => {
  let contract;
  let hashedHand;

  beforeEach("deploy the contract", async function() {
    contract = await RockPaperScissors.new(false, { from: alice });
  });

  it("initializes correctly", async function() {
    (await contract.getOwner()).should.be.equal(alice);
    (await contract.isPaused()).should.be.equal(false);
  });

  describe("hashHand()", () => {
    it("gives different outputs with the same secret and different hands", async function() {
      const rockHash = await contract.hashHand(ROCK, secret, { from: alice });
      const paperHash = await contract.hashHand(PAPER, secret, { from: alice });
      const scissorsHash = await contract.hashHand(SCISSORS, secret, { from: alice });

      rockHash.should.be.not.equal(paperHash);
      rockHash.should.be.not.equal(scissorsHash);
      paperHash.should.be.not.equal(scissorsHash);
    });

    it("gives different outputs with the same hand and different secrets", async function() {
      (await contract.hashHand(ROCK, secret), { from: alice }).should.be.not.equal(
        await contract.hashHand(ROCK, "12345", { from: alice })
      );
    });

    it("gives different outputs when called from different addresses with the same params", async function() {
      (await contract.hashHand(ROCK, secret, { from: alice })).should.be.not.equal(
        await contract.hashHand(ROCK, secret, { from: bob })
      );
    });

    it("rejects null hand", async function() {
      await expectRevert(contract.hashHand(NULL, secret, { from: alice }), "Null hand");
    });

    it("rejects null secret", async function() {
      await expectRevert(contract.hashHand(ROCK, "0", { from: alice }), "Null secret");
    });
  });

  describe("createMatch()", () => {
    beforeEach("hash a hand", async function() {
      hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
    });

    it("allows to create a match", async function() {
      const { tx, logs } = await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });

      const match = await contract.games(hashedHand);

      const currentTime = await time.latest(); // Gets the last block timestamp
      const deadline = currentTime.add(time.duration.hours(timeoutInHours)); // deadline should be currentTime + 1 hour

      match.stake.should.be.bignumber.equal(stake);
      match.timeout.should.be.bignumber.equal(timeoutInHours);
      match.deadline.should.be.bignumber.equal(deadline);
      match.secondPlayer.should.be.equal(zero_address);
      match.secondPlayerHand.should.be.bignumber.equal(zero_uint256);

      await expectEvent.inLogs(logs, "LogMatchCreated", { sender: alice, gameId: hashedHand, stake, deadline });
    });

    it("rejects passing a hashedHand of 0x0", async function() {
      await expectRevert(
        contract.createMatch("0x0", timeoutInHours, { from: alice, value: stake }),
        "Invalid hashed hand"
      );
    });

    it("rejects passing a timeout of 0", async function() {
      await expectRevert(
        contract.createMatch(hashedHand, "0", { from: alice, value: stake }),
        "Timeout must be at least 1 hour"
      );
    });

    it("rejects using a hashed hand twice", async function() {
      await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
      await expectRevert(
        contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake }),
        "Password used"
      );
    });
  });

  describe("acceptMatch()", async function() {
    beforeEach("create a match", async function() {
      hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
      await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
    });

    it("allows to accept a match", async function() {
      const { tx, logs } = await contract.acceptMatch(hashedHand, { from: bob, value: stake });

      const game = await contract.games(hashedHand);

      const currentTime = await time.latest(); // Gets the last block timestamp
      const deadline = currentTime.add(time.duration.hours(timeoutInHours)); // deadline should be currentTime + 1 hour

      game.secondPlayer.should.be.equal(bob);
      game.stake.should.be.bignumber.equal(stake.mul(new BN("2")));
      game.deadline.should.be.bignumber.equal(deadline);

      await expectEvent.inLogs(logs, "LogMatchAccepted", {
        sender: bob,
        gameId: hashedHand,
        stake: stake.mul(new BN("2")),
        deadline
      });
    });

    it("rejects joining a non existant game", async function() {
      const gameId = await contract.hashHand(PAPER, secret, { from: mallory });

      await expectRevert(contract.acceptMatch(gameId, { from: mallory, value: stake }), "Game does not exist");
    });

    it("rejects joining after deadline has passed", async function() {
      await time.increase(time.duration.hours(timeoutInHours));
      await expectRevert(contract.acceptMatch(hashedHand, { from: mallory, value: stake }), "Deadline passed");
    });

    it("rejects joining if stake is not matched", async function() {
      await expectRevert(contract.acceptMatch(hashedHand, { from: mallory, value: "0" }), "Invalid stake");
    });

    it("rejects joining if match was already contested", async function() {
      await contract.acceptMatch(hashedHand, { from: bob, value: stake });
      await expectRevert(
        contract.acceptMatch(hashedHand, { from: mallory, value: stake.mul(new BN("2")) }),
        "Match contested by another player"
      );
    });
  });

  describe("showHand()", () => {
    beforeEach("create a match and let a player join", async function() {
      hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
      await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
      await contract.acceptMatch(hashedHand, { from: bob, value: stake });
    });

    it("allows to show a hand", async function() {
      const { tx, logs } = await contract.showHand(hashedHand, ROCK, { from: bob });

      const game = await contract.games(hashedHand);

      const currentTime = await time.latest(); // Gets the last block timestamp
      const deadline = currentTime.add(time.duration.hours(timeoutInHours)); // deadline should be currentTime + 1 hour

      game.secondPlayerHand.should.be.bignumber.equal(ROCK);
      game.deadline.should.be.bignumber.equal(deadline);

      await expectEvent.inLogs(logs, "LogHandShown", {
        sender: bob,
        gameId: hashedHand,
        deadline,
        hand: ROCK
      });
    });

    it("rejects showing a null hand", async function() {
      await expectRevert(contract.showHand(hashedHand, "0", { from: bob }), "Invalid hand");
    });

    it("rejects showing a hand if the caller is not the second player", async function() {
      await expectRevert(contract.showHand(hashedHand, ROCK, { from: mallory }), "Invalid player address");
    });
    it("rejects picking the hand twice", async function() {
      await contract.showHand(hashedHand, ROCK, { from: bob });
      await expectRevert(contract.showHand(hashedHand, ROCK, { from: bob }), "Cannot pick hand twice");
    });
    it("rejects showing hand if deadline has passed", async function() {
      await time.increase(time.duration.hours(timeoutInHours));
      await expectRevert(contract.showHand(hashedHand, ROCK, { from: bob }), "Deadline passed");
    });
  });

  describe("resolveMatch()", async function() {
    describe("Normal operation", () => {
      describe("Alice = ROCK & Bob = ROCK", async function() {
        it("ties", async function() {
          hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, ROCK, { from: bob });

          const { tx, logs } = await contract.resolveMatch(ROCK, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(stake);
          (await contract.balances(bob)).should.be.bignumber.equal(stake);

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: zero_address,
            firstPlayerWage: stake,
            secondPlayerWage: stake
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: alice, amount: stake });
          await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: bob, amount: stake });
        });
      });

      describe("Alice = PAPER & Bob = PAPER", async function() {
        it("ties", async function() {
          hashedHand = await contract.hashHand(PAPER, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, PAPER, { from: bob });

          const { tx, logs } = await contract.resolveMatch(PAPER, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(stake);
          (await contract.balances(bob)).should.be.bignumber.equal(stake);

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: zero_address,
            firstPlayerWage: stake,
            secondPlayerWage: stake
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: alice, amount: stake });
          await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: bob, amount: stake });
        });
      });

      describe("Alice = SCISSORS & Bob = SCISSORS", async function() {
        it("ties", async function() {
          hashedHand = await contract.hashHand(SCISSORS, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, SCISSORS, { from: bob });

          const { tx, logs } = await contract.resolveMatch(SCISSORS, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(stake);
          (await contract.balances(bob)).should.be.bignumber.equal(stake);

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: zero_address,
            firstPlayerWage: stake,
            secondPlayerWage: stake
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: alice, amount: stake });
          await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: bob, amount: stake });
        });
      });

      describe("Alice = ROCK & Bob = PAPER", async function() {
        it("Bob wins", async function() {
          hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, PAPER, { from: bob });

          const { tx, logs } = await contract.resolveMatch(ROCK, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(zero_uint256);
          (await contract.balances(bob)).should.be.bignumber.equal(stake.mul(new BN("2")));

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: bob,
            firstPlayerWage: zero_uint256,
            secondPlayerWage: stake.mul(new BN("2"))
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", {
            sender: alice,
            to: bob,
            amount: stake.mul(new BN("2"))
          });
        });
      });

      describe("Alice = ROCK & Bob = SCISSORS", async function() {
        it("Alice wins", async function() {
          hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, SCISSORS, { from: bob });

          const { tx, logs } = await contract.resolveMatch(ROCK, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(stake.mul(new BN("2")));
          (await contract.balances(bob)).should.be.bignumber.equal(zero_uint256);

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: alice,
            firstPlayerWage: stake.mul(new BN("2")),
            secondPlayerWage: zero_uint256
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", {
            sender: alice,
            to: alice,
            amount: stake.mul(new BN("2"))
          });
        });
      });

      describe("Alice = PAPER & Bob = ROCK", async function() {
        it("Alice wins", async function() {
          hashedHand = await contract.hashHand(PAPER, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, ROCK, { from: bob });

          const { tx, logs } = await contract.resolveMatch(PAPER, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(stake.mul(new BN("2")));
          (await contract.balances(bob)).should.be.bignumber.equal(zero_uint256);

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: alice,
            firstPlayerWage: stake.mul(new BN("2")),
            secondPlayerWage: zero_uint256
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", {
            sender: alice,
            to: alice,
            amount: stake.mul(new BN("2"))
          });
        });
      });

      describe("Alice = PAPER & Bob = SCISSORS", async function() {
        it("Bob wins", async function() {
          hashedHand = await contract.hashHand(PAPER, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, SCISSORS, { from: bob });

          const { tx, logs } = await contract.resolveMatch(PAPER, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(zero_uint256);
          (await contract.balances(bob)).should.be.bignumber.equal(stake.mul(new BN("2")));

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: bob,
            firstPlayerWage: zero_uint256,
            secondPlayerWage: stake.mul(new BN("2"))
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", {
            sender: alice,
            to: bob,
            amount: stake.mul(new BN("2"))
          });
        });
      });

      describe("Alice = SCISSORS & Bob = ROCK", async function() {
        it("Bob wins", async function() {
          hashedHand = await contract.hashHand(SCISSORS, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, ROCK, { from: bob });

          const { tx, logs } = await contract.resolveMatch(SCISSORS, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(zero_uint256);
          (await contract.balances(bob)).should.be.bignumber.equal(stake.mul(new BN("2")));

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: bob,
            firstPlayerWage: zero_uint256,
            secondPlayerWage: stake.mul(new BN("2"))
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", {
            sender: alice,
            to: bob,
            amount: stake.mul(new BN("2"))
          });
        });
      });

      describe("Alice = SCISSORS & Bob = PAPER", async function() {
        it("Alice wins", async function() {
          hashedHand = await contract.hashHand(SCISSORS, secret, { from: alice });
          await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
          await contract.acceptMatch(hashedHand, { from: bob, value: stake });
          await contract.showHand(hashedHand, PAPER, { from: bob });

          const { tx, logs } = await contract.resolveMatch(SCISSORS, secret, { from: alice });

          (await contract.balances(alice)).should.be.bignumber.equal(stake.mul(new BN("2")));
          (await contract.balances(bob)).should.be.bignumber.equal(zero_uint256);

          await expectEvent.inLogs(logs, "LogMatchResolved", {
            sender: alice,
            gameId: hashedHand,
            winner: alice,
            firstPlayerWage: stake.mul(new BN("2")),
            secondPlayerWage: zero_uint256
          });

          await expectEvent.inLogs(logs, "LogBalanceIncreased", {
            sender: alice,
            to: alice,
            amount: stake.mul(new BN("2"))
          });
        });
      });

      afterEach("game is zeroed out", async function() {
        gameIsZeroedOut(await contract.games(hashedHand));
      });
    });

    describe("Prohibited operation", () => {
      beforeEach("create a match", async function() {
        hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
        await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
      });

      it("rejects if second player has not joined", async function() {
        await expectRevert(contract.resolveMatch(ROCK, secret, { from: alice }), "Player two has not made a move yet");
      });

      it("rejects if deadline has passed", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await contract.showHand(hashedHand, ROCK, { from: bob });
        await time.increase(time.duration.hours(timeoutInHours).add(new BN("1")));
        await expectRevert(contract.resolveMatch(ROCK, secret, { from: alice }), "Deadline passed");
      });

      it("rejects if hand is null", async function() {
        await expectRevert(contract.resolveMatch(NULL, secret, { from: alice }), "Null hand");
      });

      it("rejects if secret is null", async function() {
        await expectRevert(contract.resolveMatch(ROCK, zero_uint256, { from: alice }), "Null secret");
      });
    });
  });

  describe("punish()", () => {
    beforeEach("create a match", async function() {
      hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
      await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
    });

    describe("Normal operation", () => {
      beforeEach("create a match and make a second player join", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await contract.showHand(hashedHand, ROCK, { from: bob });
      });

      it("allows to punish the creator of the game", async function() {
        await time.increase(time.duration.hours(timeoutInHours).add(new BN("1")));
        const { tx, logs } = await contract.punish(hashedHand, { from: bob });

        (await contract.balances(bob)).should.be.bignumber.equal(stake.mul(new BN("2")));

        expectEvent.inLogs(logs, "LogPunishCalled", { sender: bob, gameId: hashedHand });
        expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: bob, to: bob, amount: stake.mul(new BN("2")) });

        gameIsZeroedOut(await contract.games(hashedHand));
      });
    });

    describe("Prohibited operation", () => {
      it("rejects punishing a null game", async function() {
        await expectRevert(contract.punish("0x0", { from: bob }), "Invalid game key");
      });

      it("rejects if a player has not joined", async function() {
        await expectRevert(contract.punish(hashedHand, { from: mallory }), "Only second player can call this function");
      });

      it("rejects if the caller is not the second player", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await expectRevert(contract.punish(hashedHand, { from: mallory }), "Only second player can call this function");
      });

      it("rejects if the second player has not shown a hand", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await expectRevert(contract.punish(hashedHand, { from: bob }), "You have to show your hand before calling");
      });

      it("rejects if the deadline has not passed", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await contract.showHand(hashedHand, ROCK, { from: bob });
        await expectRevert(contract.punish(hashedHand, { from: bob }), "Deadline has not passed");
      });

      it("rejects punishing a resolved game", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await contract.showHand(hashedHand, ROCK, { from: bob });
        await contract.resolveMatch(ROCK, secret, { from: alice });
        await expectRevert(contract.punish(hashedHand, { from: bob }), "Only second player can call this function");
      });
    });
  });

  // /*
  //   @dev: Lets the game's creator recover the stake after the timeout, and punish the second player if no hand
  //       was comitted
  //
  //   @param hand Hand the weapon choice
  //   @param secret uint256 the secret used to hash the hand
  // */
  // function cancelGame(Hand firstPlayerHand, uint256 secret) public {
  //   bytes32 hashedHand = hashHand(firstPlayerHand, secret);
  //
  //   uint256 stake = games[hashedHand].stake;
  //   // Does not make sense to cancel a game that has not stake. This allows us to filter
  //   // both non-existant games and finished games.
  //   require(stake > 0, "No stake");
  //
  //   require(games[hashedHand].deadline < now, "Deadline has not passed");
  //   require(games[hashedHand].secondPlayerHand != Hand.NULL, "Cannot cancel, game is on");
  //
  //   zeroOutGameEntry(hashedHand);
  //
  //   emit LogCancelCalled(msg.sender, hashedHand);
  //
  //   if(stake > 0)
  //     increaseBalance(msg.sender, stake);
  // }

  describe("cancelGame()", () => {
    beforeEach("create a game", async function() {
      hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
      await contract.createMatch(hashedHand, timeoutInHours, { from: alice, value: stake });
    });

    describe("Normal operation", () => {
      it("allows to cancel a game if a player has not joined", async function() {
        await time.increase(time.duration.hours(timeoutInHours).add(new BN("1")));
        const { tx, logs } = await contract.cancelGame(ROCK, secret, { from: alice });

        (await contract.balances(alice)).should.be.bignumber.equal(stake);

        await expectEvent.inLogs(logs, "LogCancelCalled", { sender: alice, gameId: hashedHand });
        await expectEvent.inLogs(logs, "LogBalanceIncreased", { sender: alice, to: alice, amount: stake });
      });

      it("allows to punish the second player if a hand was not shown", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await time.increase(time.duration.hours(timeoutInHours).add(new BN("1")));
        const { tx, logs } = await contract.cancelGame(ROCK, secret, { from: alice });

        (await contract.balances(alice)).should.be.bignumber.equal(stake.mul(new BN("2")));

        await expectEvent.inLogs(logs, "LogCancelCalled", { sender: alice, gameId: hashedHand });
        await expectEvent.inLogs(logs, "LogBalanceIncreased", {
          sender: alice,
          to: alice,
          amount: stake.mul(new BN("2"))
        });
      });

      afterEach("game is zeroed out", async function() {
        gameIsZeroedOut(await contract.games(hashedHand));
      });
    });

    describe("Prohibited operation", () => {
      it("rejects if hand is null", async function() {
        await expectRevert(contract.cancelGame(NULL, secret, { from: alice }), "Null hand");
      });
      it("rejects if secret is null", async function() {
        await expectRevert(contract.cancelGame(ROCK, zero_uint256, { from: alice }), "Null secret");
      });

      it("rejects if second player has shown a hand", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await contract.showHand(hashedHand, ROCK, { from: bob });
        await expectRevert(contract.cancelGame(ROCK, secret, { from: alice }), "Cannot cancel, game is on");
      });

      it("rejects if deadline has not passed", async function() {
        await expectRevert(contract.cancelGame(ROCK, secret, { from: alice }), "Deadline has not passed");
      });

      it("rejects if game has been resolved", async function() {
        await contract.acceptMatch(hashedHand, { from: bob, value: stake });
        await contract.showHand(hashedHand, ROCK, { from: bob });
        await contract.resolveMatch(ROCK, secret, { from: alice });
        await expectRevert(contract.cancelGame(ROCK, secret, { from: alice }), "No stake");
      });
    });
  });
});
