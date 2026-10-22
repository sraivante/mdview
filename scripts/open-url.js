// Opens the browser at MDVIEW, optionally with a file to load (?open=...)
const path = require('path');
const { spawn } = require('child_process');

const file = process.argv[2];
const url = 'http://localhost:4200/' + (file ? '?open=' + encodeURIComponent(path.resolve(file)) : '');
spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
