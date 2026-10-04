#!/usr/bin/env node
const fs = require('node:fs');
const { verifyRecord } = require('../src/game/recording');

const filename = process.argv[2];
if (!filename || process.argv.length !== 3) {
  console.error('Usage: node --require ts-node/register scripts/replay.cjs FILE.json');
  process.exitCode = 2;
} else {
  try {
    const file = fs.statSync(filename);
    if (!file.isFile() || file.size > 128 * 1024 * 1024) throw new Error('Recording must be a JSON file no larger than 128 MiB');
    const result = verifyRecord(JSON.parse(fs.readFileSync(filename, 'utf8')));
    if (!result.valid) {
      console.error(`Replay failed after ${result.actions} actions: ${result.error}`);
      process.exitCode = 1;
    } else console.log(`Replay verified: ${result.actions} accepted actions, final state and scores match.`);
  } catch (error) {
    console.error(`Replay failed: ${error.message}`);
    process.exitCode = 1;
  }
}
