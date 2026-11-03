// Bridges the Stockfish WASM build to stdin/stdout so tests can drive it from
// a child process (the engine's Node detection does not work inside Vitest).
const readline = require('node:readline');
const sf = require('stockfish')('lite-single', (line) => process.stdout.write(line + '\n'));
readline.createInterface({ input: process.stdin }).on('line', (cmd) => {
  if (cmd === 'quit') process.exit(0);
  sf.processCommand(cmd);
});
