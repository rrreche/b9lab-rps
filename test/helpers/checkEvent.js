const BN = require("web3-utils").BN;

// Utility to check events
function checkEvent(props) {
  if (!props.logs) throw new Error("Needs property logs");
  if (!props.name) throw "Needs property name";
  if (!props.params) throw "Needs property values";

  let eventExists = false;

  for (i in props.logs) {
    let log = props.logs[i];
    if (log.event === props.name) {
      eventExists = true;
      for (paramIndex in props.params) {
        let param = props.params[paramIndex];
        if (!log.args[param.name]) assert.fail(`Event field ${param.name} not found`);

        if (BN.isBN(log.args[param.name])) {
          assert.strictEqual(log.args[param.name].toString(), param.val.toString(), "Event value did not match");
        } else {
          assert.strictEqual(log.args[param.name], param.val, "Event value did not match");
        }
      }
    }
  }

  assert.ok(eventExists);
}

module.exports = checkEvent;
