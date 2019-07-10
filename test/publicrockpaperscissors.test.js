const PublicRockPaperScissors = artifacts.require("./PublicRockPaperScissors.sol");
const { BN, toWei, asciiToHex, isHexStrict } = require("web3-utils");
const moment = require("moment");
const truffleAssert = require("truffle-assertions");
const checkEvent = require("./helpers/checkEvent");

contract("PublicRockPaperScissors", accounts => {
  let alice, bob, carol, david;
  let contract;

  const stake = new BN(toWei("1", "shannon"));

  const NULL = new BN("0");
  const ROCK = new BN("1");
  const PAPER = new BN("2");
  const SCISSORS = new BN("3");
  const secret = new BN("1234");

  const zero_address = "0x0000000000000000000000000000000000000000";
  const zero_bytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

  before("define Alice, Bob and Carol", function() {
    [alice, bob, carol, david] = accounts;
    // Alice: contract owner
    // Bob: offchain user, does not have participation in tests
    // Carol: exchange
    // David: dishonest user
  });

  beforeEach("initialize contract", async function() {
    contract = await PublicRockPaperScissors.new(false, { from: alice });
  });

  describe("hashHand()", () => {
    it("returns hex value", async function() {
      const hashedHand = await contract.hashHand(ROCK, secret, { from: alice });

      assert.isTrue(isHexStrict(hashedHand));
    });

    it("returns different values when choosing rock, paper, or scissor", async function() {
      const rockHash = await contract.hashHand(ROCK, secret, { from: alice });
      const paperHash = await contract.hashHand(PAPER, secret, { from: alice });
      const scissorsHash = await contract.hashHand(SCISSORS, secret, { from: alice });

      assert.notEqual(rockHash, paperHash);
      assert.notEqual(rockHash, scissorsHash);
      assert.notEqual(scissorsHash, paperHash);
    });

    it("returns different values if changing secret", async function() {
      const firstHash = await contract.hashHand(ROCK, secret, { from: alice });
      const secondHash = await contract.hashHand(ROCK, "4321", { from: alice });

      assert.notEqual(firstHash, secondHash);
    });

    it("returns different values if changing sender", async function() {
      const aliceHash = await contract.hashHand(ROCK, secret, { from: alice });
      const bobHash = await contract.hashHand(ROCK, secret, { from: bob });

      assert.notEqual(aliceHash, bobHash);
    });

    it("rejects giving a 0 value", async function() {
      try {
        await contract.hashHand(new BN("0"), secret, { from: alice });

        assert.fail("Transaction should have failed");
      } catch (e) {
        assert.include(e.toString(), "Null hand");
      }
    });

    it("rejects giving values higher than 3 (SCISSORS)", async function() {
      try {
        await contract.hashHand(new BN("4"), secret, { from: alice });

        assert.fail("Transaction should have failed");
      } catch (e) {
        assert.include(e.toString(), "VM Exception while processing transaction: invalid opcode");
      }
    });
  });

  describe("createMatch", () => {
    let hashedHand;

    beforeEach("hash a hand", async function() {
      hashedHand = await contract.hashHand(ROCK, secret, { from: alice });
    });

    describe("With stake", () => {
      it("updates the contract state correctly", async function() {
        const txResult = await contract.createMatch(hashedHand, { from: alice, value: stake });

        const game = await contract.games("0");
        const gameCount = await contract.gameCount();

        assert.strictEqual(game.firstPlayerHashedHand, hashedHand);
        assert.strictEqual(game.secondPlayerHashedHand, zero_bytes32);
        assert.strictEqual(game.stake.toString(), stake.toString());
        assert.strictEqual(game.firstPlayer, alice);
        assert.strictEqual(game.secondPlayer, zero_address);
        assert.strictEqual(game.firstPlayerHand.toString(), "0");
        assert.strictEqual(game.secondPlayerHand.toString(), "0");

        assert.strictEqual(gameCount.toString(), "1");

        truffleAssert.eventEmitted(txResult, "LogMatchCreated", ev => {
          return (
            ev.sender === alice &&
            ev.gameId.toString() === "0" &&
            ev.firstPlayerHashedHand === hashedHand &&
            ev.stake.toString() === stake.toString()
          );
        });
      });
    });

    describe("Without stake", () => {
      it("updates the contract state correctly", async function() {
        const txResult = await contract.createMatch(hashedHand, { from: alice });

        const game = await contract.games("0");
        const gameCount = await contract.gameCount();

        assert.strictEqual(game.firstPlayerHashedHand, hashedHand);
        assert.strictEqual(game.secondPlayerHashedHand, zero_bytes32);
        assert.strictEqual(game.stake.toString(), "0");
        assert.strictEqual(game.firstPlayer, alice);
        assert.strictEqual(game.secondPlayer, zero_address);
        assert.strictEqual(game.firstPlayerHand.toString(), "0");
        assert.strictEqual(game.secondPlayerHand.toString(), "0");

        assert.strictEqual(gameCount.toString(), "1");

        truffleAssert.eventEmitted(txResult, "LogMatchCreated", ev => {
          return (
            ev.sender === alice &&
            ev.gameId.toString() === "0" &&
            ev.firstPlayerHashedHand === hashedHand &&
            ev.stake.toString() === "0"
          );
        });
      });
    });

    describe("When multiple games are created", () => {
      it("increases game count and IDs", async function() {
        await contract.createMatch(hashedHand, { from: alice });
        await contract.createMatch(hashedHand, { from: alice });

        const gameCount = await contract.gameCount();
        assert.strictEqual(gameCount.toString(), "2");
      });
    });
  });

  describe("challengeMatch()", async function() {
    let aliceHashedHand, bobHashedHand;

    beforeEach("create hashed hands and make a match", async function() {
      aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
      bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
      await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
    });

    it("updates the contract state correctly", async function() {
      const txResult = await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });

      const game = await contract.games("0");

      assert.strictEqual(game.secondPlayer, bob);
      assert.strictEqual(game.secondPlayerHashedHand, bobHashedHand);
      assert.strictEqual(game.stake.toString(), stake.mul(new BN("2")).toString());

      truffleAssert.eventEmitted(txResult, "LogMatchChallenged", ev => {
        return (
          ev.sender === bob &&
          ev.gameId.toString() === "0" &&
          ev.secondPlayerHashedHand === bobHashedHand &&
          ev.stake.toString() === stake.mul(new BN("2")).toString()
        );
      });
    });

    it("rejects if deadline has passed");

    it("rejects if match has already been contested", async function() {
      try {
        await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
        await contract.challengeMatch("0", "0x0", { from: carol, value: stake });
        assert.fail("Transaction should have failed");
      } catch (e) {
        assert.include(e.toString(), "This match is already contested");
      }
    });

    it("rejects if attached ether stake is not equal to the opponent", async function() {
      try {
        await contract.challengeMatch("0", bobHashedHand, { from: bob });
        assert.fail("Transaction should have failed");
      } catch (e) {
        assert.include(e.toString(), "You must put the same stake as the opponent");
      }
    });
  });

  // function revealHand(uint256 gameId, Hand hand, uint256 secret) public returns (bool) {
  //   require(hand != Hand.NULL); // Cannot reveal a null hand.
  //   bytes32 hashedHand = hashHand(hand, secret);
  //
  //   if(msg.sender == games[gameId].firstPlayer) {
  //     require(hashedHand == games[gameId].firstPlayerHashedHand); // Correctly reveal secrets
  //     games[gameId].firstPlayerHand = hand;
  //   } else if(msg.sender == games[gameId].secondPlayer) {
  //     require(hashedHand == games[gameId].secondPlayerHashedHand); // Correctly reveal secrets
  //     games[gameId].firstPlayerHand = hand;
  //   } else {
  //     revert();
  //   }
  //
  //   emit LogHandRevealed(msg.sender, gameId, hand);
  //
  //   return true;
  //
  // }

  describe("revealHand()", () => {
    describe("First player", () => {
      describe("When no player has joined the match", () => {
        it("rejects");
      });

      describe("When the revealed hand is null", () => {
        it("rejects", async function() {
          try {
            const aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
            const bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
            await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
            await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
            await contract.revealHand("0", NULL, secret, { from: alice });

            assert.fail("Transaction should have failed");
          } catch (e) {
            assert.include(e.toString(), "Cannot reveal a null hand");
          }
        });
      });

      describe("When he / she picked ROCK", () => {
        it("correctly reveals ROCK");
        it("rejects PAPER");
        it("rejects SCISSORS");
        it("rejects incorrect secret");
      });

      describe("When he / she picked PAPER", () => {
        it("correctly reveals PAPER");
        it("rejects ROCK");
        it("rejects SCISSORS");
        it("rejects incorrect secret");
      });

      describe("When he / she picked SCISSORS", () => {
        it("correctly reveals SCISSORS");
        it("rejects PAPER");
        it("rejects SCISSORS");
        it("rejects incorrect secret");
      });
    });

    describe("Second player", () => {
      describe("When he / she picked ROCK", () => {
        it("correctly reveals ROCK");
        it("rejects PAPER");
        it("rejects SCISSORS");
        it("rejects incorrect secret");
      });

      describe("When he / she picked PAPER", () => {
        it("correctly reveals PAPER");
        it("rejects ROCK");
        it("rejects SCISSORS");
        it("rejects incorrect secret");
      });

      describe("When he / she picked SCISSORS", () => {
        it("correctly reveals SCISSORS");
        it("rejects PAPER");
        it("rejects SCISSORS");
        it("rejects incorrect secret");
      });
    });
  });

  describe("resolveMatch()", () => {
    describe("When both players have revealed hands", () => {
      describe("When both player pick the same hand", () => {
        describe("with ROCK", () => {
          it("ties", async function() {
            const aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
            const bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
            await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
            await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
            await contract.revealHand("0", ROCK, secret, { from: alice });
            await contract.revealHand("0", ROCK, secret, { from: bob });

            const txResult = await contract.resolveMatch("0", { from: alice });

            truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
              return ev.sender === alice && ev.to === alice && ev.amount.toString() === stake.toString();
            });

            truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
              return ev.sender === alice && ev.to === bob && ev.amount.toString() === stake.toString();
            });

            truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
              return ev.sender === alice && ev.gameId.toString() === "0" && ev.winner === zero_address;
            });

            assert.strictEqual((await contract.balances(alice)).toString(), stake.toString());
            assert.strictEqual((await contract.balances(bob)).toString(), stake.toString());
          });
        });
        describe("with PAPER", () => {
          it("ties", async function() {
            const aliceHashedHand = await contract.hashHand(PAPER, secret, { from: alice });
            const bobHashedHand = await contract.hashHand(PAPER, secret, { from: bob });
            await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
            await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
            await contract.revealHand("0", PAPER, secret, { from: alice });
            await contract.revealHand("0", PAPER, secret, { from: bob });

            const txResult = await contract.resolveMatch("0", { from: alice });

            truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
              return ev.sender === alice && ev.to === alice && ev.amount.toString() === stake.toString();
            });

            truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
              return ev.sender === alice && ev.to === bob && ev.amount.toString() === stake.toString();
            });

            truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
              return ev.sender === alice && ev.gameId.toString() === "0" && ev.winner === zero_address;
            });

            assert.strictEqual((await contract.balances(alice)).toString(), stake.toString());
            assert.strictEqual((await contract.balances(bob)).toString(), stake.toString());
          });
        });
        describe("with SCISSORS", () => {
          it("ties", async function() {
            const aliceHashedHand = await contract.hashHand(SCISSORS, secret, { from: alice });
            const bobHashedHand = await contract.hashHand(SCISSORS, secret, { from: bob });
            await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
            await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
            await contract.revealHand("0", SCISSORS, secret, { from: alice });
            await contract.revealHand("0", SCISSORS, secret, { from: bob });

            const txResult = await contract.resolveMatch("0", { from: alice });

            truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
              return ev.sender === alice && ev.to === alice && ev.amount.toString() === stake.toString();
            });

            truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
              return ev.sender === alice && ev.to === bob && ev.amount.toString() === stake.toString();
            });

            truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
              return ev.sender === alice && ev.gameId.toString() === "0" && ev.winner === zero_address;
            });

            assert.strictEqual((await contract.balances(alice)).toString(), stake.toString());
            assert.strictEqual((await contract.balances(bob)).toString(), stake.toString());
          });
        });
      });

      describe("When ALICE=ROCK and BOB=SCISSORS", () => {
        it("gives victory and stake to Alice", async function() {
          const aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(SCISSORS, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", ROCK, secret, { from: alice });
          await contract.revealHand("0", SCISSORS, secret, { from: bob });

          const txResult = await contract.resolveMatch("0", { from: alice });

          truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
            return ev.sender === alice && ev.to === alice && ev.amount.toString() === stake.mul(new BN("2")).toString();
          });

          truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
            return ev.sender === alice && ev.gameId.toString() === "0" && ev.winner === alice;
          });

          assert.strictEqual((await contract.balances(alice)).toString(), stake.mul(new BN("2")).toString());
          assert.strictEqual((await contract.balances(bob)).toString(), "0");
        });
      });

      describe("When ALICE=PAPER and BOB=ROCK", () => {
        it("gives victory and stake to Alice", async function() {
          const aliceHashedHand = await contract.hashHand(PAPER, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", PAPER, secret, { from: alice });
          await contract.revealHand("0", ROCK, secret, { from: bob });

          const txResult = await contract.resolveMatch("0", { from: alice });

          truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
            return ev.sender === alice && ev.to === alice && ev.amount.toString() === stake.mul(new BN("2")).toString();
          });

          truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
            return ev.sender === alice && ev.gameId.toString() === "0" && ev.winner === alice;
          });

          assert.strictEqual((await contract.balances(alice)).toString(), stake.mul(new BN("2")).toString());
          assert.strictEqual((await contract.balances(bob)).toString(), "0");
        });
      });

      describe("When ALICE=SCISSORS and BOB=PAPER", () => {
        it("gives victory and stake to Alice", async function() {
          const aliceHashedHand = await contract.hashHand(SCISSORS, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(PAPER, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", SCISSORS, secret, { from: alice });
          await contract.revealHand("0", PAPER, secret, { from: bob });

          const txResult = await contract.resolveMatch("0", { from: alice });

          truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
            return ev.sender === alice && ev.to === alice && ev.amount.toString() === stake.mul(new BN("2")).toString();
          });

          truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
            return ev.sender === alice && ev.gameId.toString() === "0" && ev.winner === alice;
          });

          assert.strictEqual((await contract.balances(alice)).toString(), stake.mul(new BN("2")).toString());
          assert.strictEqual((await contract.balances(bob)).toString(), "0");
        });
      });

      describe("When ALICE=ROCK and BOB=PAPER", () => {
        it("gives victory and stake to Bob", async function() {
          const aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(PAPER, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", ROCK, secret, { from: alice });
          await contract.revealHand("0", PAPER, secret, { from: bob });

          const txResult = await contract.resolveMatch("0", { from: bob });

          truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
            return ev.sender === bob && ev.to === bob && ev.amount.toString() === stake.mul(new BN("2")).toString();
          });

          truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
            return ev.sender === bob && ev.gameId.toString() === "0" && ev.winner === bob;
          });

          assert.strictEqual((await contract.balances(bob)).toString(), stake.mul(new BN("2")).toString());
          assert.strictEqual((await contract.balances(alice)).toString(), "0");
        });
      });

      describe("When ALICE=PAPER and BOB=SCISSORS", () => {
        it("gives victory and stake to Bob", async function() {
          const aliceHashedHand = await contract.hashHand(PAPER, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(SCISSORS, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", PAPER, secret, { from: alice });
          await contract.revealHand("0", SCISSORS, secret, { from: bob });

          const txResult = await contract.resolveMatch("0", { from: bob });

          truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
            return ev.sender === bob && ev.to === bob && ev.amount.toString() === stake.mul(new BN("2")).toString();
          });

          truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
            return ev.sender === bob && ev.gameId.toString() === "0" && ev.winner === bob;
          });

          assert.strictEqual((await contract.balances(bob)).toString(), stake.mul(new BN("2")).toString());
          assert.strictEqual((await contract.balances(alice)).toString(), "0");
        });
      });

      describe("When ALICE=SCISSORS and BOB=ROCK", () => {
        it("gives victory and stake to Bob", async function() {
          const aliceHashedHand = await contract.hashHand(SCISSORS, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", SCISSORS, secret, { from: alice });
          await contract.revealHand("0", ROCK, secret, { from: bob });

          const txResult = await contract.resolveMatch("0", { from: bob });

          truffleAssert.eventEmitted(txResult, "LogBalanceIncreased", ev => {
            return ev.sender === bob && ev.to === bob && ev.amount.toString() === stake.mul(new BN("2")).toString();
          });

          truffleAssert.eventEmitted(txResult, "LogMatchResolved", ev => {
            return ev.sender === bob && ev.gameId.toString() === "0" && ev.winner === bob;
          });

          assert.strictEqual((await contract.balances(bob)).toString(), stake.mul(new BN("2")).toString());
          assert.strictEqual((await contract.balances(alice)).toString(), "0");
        });
      });
    });

    describe("When first player has not revealed his / her hand", () => {
      it("rejects", async function() {
        try {
          const aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", ROCK, secret, { from: alice });
          await contract.resolveMatch("0", { from: alice });

          assert.fail("Transaction should have failed");
        } catch (e) {
          assert.include(e.toString(), "At least one hand has not been revealed yet");
        }
      });
    });

    describe("When second player has not revealed his / her hand", () => {
      it("rejects", async function() {
        try {
          const aliceHashedHand = await contract.hashHand(ROCK, secret, { from: alice });
          const bobHashedHand = await contract.hashHand(ROCK, secret, { from: bob });
          await contract.createMatch(aliceHashedHand, { from: alice, value: stake });
          await contract.challengeMatch("0", bobHashedHand, { from: bob, value: stake });
          await contract.revealHand("0", ROCK, secret, { from: bob });
          await contract.resolveMatch("0", { from: alice });

          assert.fail("Transaction should have failed");
        } catch (e) {
          assert.include(e.toString(), "At least one hand has not been revealed yet");
        }
      });
    });
  });

  describe("withdraw()", () => {
    beforeEach("resolve a game", async function() {});
  });
});
