const gulp = require("gulp");
const watch = require("gulp-watch");
const exec = require("child_process").exec;

gulp.task("default", async () => {
  console.log("Options: ", "test");
});

gulp.task("watch", async cb => {
  runTest();

  watch(["./contracts/**/*.sol"], () => {
    compileContractsAndRunTest();
  });

  watch(["./test/**/*.js"], () => {
    runTest();
  });
});

const compileContractsAndRunTest = () => {
  console.log("\n===============\nCompiling and testing\n===============\n");
  exec("rm -rf ./build; truffle compile; truffle test", function(
    err,
    stdout,
    stderr
  ) {
    console.error(stderr);
    console.log(stdout);
  });
};

const runTest = () => {
  console.log("\n===============\nTesting\n===============\n");
  exec("truffle test", function(err, stdout, stderr) {
    console.error(stderr);
    console.log(stdout);
  });
};
