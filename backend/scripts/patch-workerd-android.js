#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const workerdRoot = path.join(root, 'node_modules', 'workerd');
const workerdPackageJson = path.join(workerdRoot, 'package.json');

if (!fs.existsSync(workerdPackageJson)) {
  console.log('workerd is not installed; skipping Android patch.');
  process.exit(0);
}

const workerdVersion = JSON.parse(fs.readFileSync(workerdPackageJson, 'utf8')).version;
const targetPackage = '@cloudflare/workerd-linux-arm64';
const targetPackageRoot = path.join(root, 'node_modules', '@cloudflare', 'workerd-linux-arm64');
const targetBin = path.join(targetPackageRoot, 'bin', 'workerd');

const files = [
  path.join(workerdRoot, 'lib', 'main.js'),
  path.join(workerdRoot, 'bin', 'workerd'),
  path.join(workerdRoot, 'install.js'),
];

const packageMap = '"android arm64 LE": "@cloudflare/workerd-linux-arm64",';
const linuxArm64Map = '"linux arm64 LE": "@cloudflare/workerd-linux-arm64",';

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function readTarString(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString().replace(/\0.*$/, "");
}

function extractPackageFiles(tgz) {
  const buffer = zlib.unzipSync(tgz);
  const wanted = new Map([
    ['package/package.json', path.join(targetPackageRoot, 'package.json')],
    ['package/bin/workerd', targetBin],
  ]);
  let offset = 0;
  let extracted = 0;
  while (offset < buffer.length) {
    const name = readTarString(buffer, offset, 100);
    const sizeText = readTarString(buffer, offset + 124, 12);
    const size = parseInt(sizeText, 8);
    offset += 512;
    if (!name || Number.isNaN(size)) break;
    const outPath = wanted.get(name);
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buffer.subarray(offset, offset + size));
      if (outPath === targetBin) fs.chmodSync(outPath, 0o755);
      extracted++;
    }
    offset += (size + 511) & ~511;
  }
  if (extracted !== wanted.size) {
    throw new Error(`Expected ${wanted.size} files from ${targetPackage}, extracted ${extracted}`);
  }
}

async function ensureLinuxArm64Package() {
  if (fs.existsSync(targetBin)) return false;
  const unscoped = targetPackage.slice(targetPackage.indexOf("/") + 1);
  const url = `https://registry.npmjs.org/${targetPackage}/-/${unscoped}-${workerdVersion}.tgz`;
  console.log(`Downloading ${targetPackage}@${workerdVersion} for Android Wrangler compatibility...`);
  extractPackageFiles(await fetchBuffer(url));
  return true;
}

function patchResolverFiles() {
  let patched = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    let next = original;

    if (!next.includes(packageMap)) {
      if (!next.includes(linuxArm64Map)) {
        throw new Error(`Could not find linux arm64 package mapping in ${file}`);
      }
      next = next.replace(linuxArm64Map, `${linuxArm64Map}\n  ${packageMap}`);
    }

    if (next !== original) {
      fs.writeFileSync(file, next);
      patched++;
    }
  }
  return patched;
}

(async () => {
  const patched = patchResolverFiles();
  const downloaded = await ensureLinuxArm64Package();
  if (patched > 0) {
    console.log(`Patched workerd Android platform mapping in ${patched} file(s).`);
  } else {
    console.log('workerd Android platform mapping already patched.');
  }
  if (!downloaded) {
    console.log('workerd Linux ARM64 package already present.');
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
