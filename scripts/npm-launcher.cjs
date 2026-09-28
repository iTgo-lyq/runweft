#!/usr/bin/env node
'use strict';
const { spawn } = require('node:child_process');
const { join, dirname } = require('node:path');
const { existsSync } = require('node:fs');
const pkg = require('../package.json');

function fail(message) { console.error(`Runweft: ${message}`); process.exitCode = 1; }
const platform = `${process.platform}-${process.arch}`;
const platformPackage = `runweft-${platform}`;
if (!Object.hasOwn(pkg.optionalDependencies, platformPackage)) {
    fail(`不支持 ${platform}。可用平台：macOS 和 Linux 的 arm64/x64。`);
} else if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) {
    fail('此安装包需要 glibc Linux；当前系统使用其他 C 库。');
} else {
    let directory;
    try { directory = dirname(require.resolve(`${platformPackage}/package.json`)); }
    catch { fail(`缺少平台包 ${platformPackage}@${pkg.version}。请重新安装并保留 optionalDependencies：npm install -g runweft@${pkg.version} --include=optional`); }
    if (directory) {
        const executable = join(directory, 'bin', 'runweft');
        if (!existsSync(executable) || !existsSync(join(directory, 'bin', 'hapi'))) {
            fail(`平台包 ${platformPackage} 不完整，请重新安装 Runweft。`);
        } else {
            const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit', env: process.env });
            const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => child.kill(signal)]);
            for (const [signal, handler] of handlers) process.on(signal, handler);
            const cleanup = () => { for (const [signal, handler] of handlers) process.off(signal, handler); };
            child.once('error', error => { cleanup(); fail(`无法启动平台程序：${error.message}`); });
            child.once('exit', (code, signal) => {
                cleanup();
                if (signal) process.kill(process.pid, signal);
                else process.exitCode = code ?? 1;
            });
        }
    }
}
