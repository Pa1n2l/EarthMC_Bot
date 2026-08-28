import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const commands = new Map();

// コマンドの読み込み関数
export async function loadCommand(commandName) {
  const filePath = path.join(__dirname, 'commands', `${commandName}.js`);
  if (!fs.existsSync(filePath)) return false;

  // キャッシュを回避するためにクエリパラメータ（タイムスタンプ）を付与
  const fileUrl = `${pathToFileURL(filePath).href}?update=${Date.now()}`;
  const command = await import(fileUrl);

  if ('data' in command && 'execute' in command) {
    commands.set(command.data.name, command);
    return true;
  }
  return false;
}

// コマンドのアンロード関数
export function unloadCommand(commandName) {
  if (commands.has(commandName)) {
    commands.delete(commandName);
    return true;
  }
  return false;
}

// 全コマンドの初期ロード
export async function loadAllCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const commandName = file.replace('.js', '');
    await loadCommand(commandName);
  }
}