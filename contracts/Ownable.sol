pragma solidity >= 0.5.0 <6.0.0;


contract Ownable {

  address private owner;

  event LogOwnerChanged(
    address indexed sender,
    address indexed newOwner
  );

  constructor() public {
    owner = msg.sender;
  }

  modifier onlyOwner {
    require(msg.sender == owner, "Can only be called by the owner");
    _;
  }

  function getOwner() public view returns(address) {
    return owner;
  }

  function setOwner(address newOwner) public onlyOwner {
    require(newOwner != address(0), "newOwner is empty");
    owner = newOwner;
    emit LogOwnerChanged(msg.sender, newOwner);
  }

}
