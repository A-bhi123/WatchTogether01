require('dotenv').config();
const { spawn } = require('child_process');

const tools = [
  ['ffprobe', process.env.FFPROBE_PATH || 'ffprobe'],
  ['ffmpeg', process.env.FFMPEG_PATH || 'ffmpeg'],
];

function explain(code) {
  if (code === 'ENOENT') {
    return 'NOT FOUND: not installed, or not in the PATH of THIS terminal/VS Code';
  }
  if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
    return 'FOUND BUT BLOCKED: Windows (Application Control / Smart App Control) is not letting it run';
  }
  return 'unknown reason';
}

function check(name, command) {
  return new Promise((resolve) => {
    console.log(`\n${name}: trying to run "${command}"`);
    let child;
    try {
      child = spawn(command, ['-version'], { windowsHide: true });
    } catch (err) {
      console.log(`${name}: FAILED (${err.code || err.message}) - ${explain(err.code)}`);
      return resolve();
    }

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (err) => {
      console.log(`${name}: FAILED (${err.code}) - ${explain(err.code)}`);
      resolve();
    });
    child.on('close', (code) => {
      console.log(code === 0 ? `${name}: OK - ${output.split('\n')[0]}` : `${name}: exited with code ${code}`);
      resolve();
    });
  });
}

(async () => {
  for (const [name, command] of tools) {
    await check(name, command);
  }
})();