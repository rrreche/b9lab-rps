pragma solidity >= 0.5.0 <0.6.0;
import "./SafeMath.sol";
contract Balances {
  using SafeMath for uint256;

  mapping(address => uint256) public balances;

  event LogBalanceIncreased(
    address indexed sender,
    address indexed to,
    uint256 amount
  );

  event LogBalanceWithdraw(
    address indexed sender,
    uint256 amount
  );

  function increaseBalance(address to, uint256 amount) internal {
    require(amount > 0);
    balances[to] = balances[to].add(amount);
    emit LogBalanceIncreased(msg.sender, to, amount);
  }

  function withdraw() public {
    uint256 balance = balances[msg.sender];
    require(balance > 0);
    balances[msg.sender] = 0;
    emit LogBalanceWithdraw(msg.sender, balance);
    msg.sender.transfer(balance);
  }

}
