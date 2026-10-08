'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skippedDirectories = new Set([
    '.git',
    'node_modules',
    'session',
    'sessions',
    'temp',
    'tmp',
    'coverage',
    'dist',
    'build'
]);

function collectJavaScript(directory, files = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!skippedDirectories.has(entry.name)) {
                collectJavaScript(path.join(directory, entry.name), files);
            }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(directory, entry.name));
        }
    }
    return files;
}

const files = collectJavaScript(root);
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        cwd: root,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        failed = true;
        process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    }
}

if (failed) process.exit(1);
console.log(`Build checks passed: ${files.length} JavaScript files parsed successfully.`);
