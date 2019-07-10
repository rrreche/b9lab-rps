pragma solidity >= 0.5.0 <6.0.0;

import "./Ownable.sol";

contract Pausable is Ownable {

  bool private paused;
  bool private dead;

  event LogPaused(
    address indexed sender,
    bool state
  );

  event LogKilled(
    address indexed sender
  );

  constructor(bool startPaused) public {
    paused = startPaused;
    // dead = false; // Inits to false by default
  }

  modifier mustBeAlive {
    require(!dead);
    _;
  }

  modifier mustBeRunning {
    require(!paused, "The contract is paused");
    _;
  }

  modifier mustBePaused {
    require(paused, "The contract must be paused");
    _;
  }

  function pause() public mustBeAlive onlyOwner mustBeRunning {
    paused = true;
    emit LogPaused(msg.sender, true);
  }

  function resume() public mustBeAlive onlyOwner mustBePaused {
    paused = false;
    emit LogPaused(msg.sender, false);
  }

  function kill() public mustBeAlive onlyOwner mustBePaused {
    dead = true;
    emit LogKilled(msg.sender);
  }

  function isPaused() public view returns (bool) {
    return paused;
  }

  function isDead() public view returns (bool) {
    return dead;
  }

}
