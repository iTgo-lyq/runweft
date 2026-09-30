export const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];

export function installationCommands(platform, version, sha256) {
  if (!platforms.includes(platform) || !/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('安装包信息不完整，请重新构建官网。');
  }
  const filename = `runweft-${platform}-${version}.tgz`;
  const checksum = platform.startsWith('darwin') ? 'shasum -a 256 -c -' : 'sha256sum -c -';
  return `# 在下载的安装包所在目录运行\nprintf '%s\\n' '${sha256}  ${filename}' | ${checksum}\nrunweft_install="$HOME/.local/share/runweft/${version}-${platform}"\nmkdir -p "$runweft_install" "$HOME/.local/bin"\ntar -xzf "${filename}" -C "$runweft_install" --strip-components=1\nln -sfn "$runweft_install/bin/runweft" "$HOME/.local/bin/runweft"\nexport PATH="$HOME/.local/bin:$PATH"\nrunweft --version`;
}
