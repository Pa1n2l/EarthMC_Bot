import cron from 'node-cron';
import { Client, GatewayIntentBits, REST, Routes, MessageFlags } from 'discord.js';
import 'dotenv/config';
import { loadAllCommands, commands } from './commandHandler.js';
import { startVotePartyTask } from './tasks/votePartyNotifier.js'; 
import { startWatcherTask } from './tasks/watcher.js'; 
import { buildFallingCache } from './utils/fallingCache.js';
import { createPool } from './db.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// DB設定オブジェクトの生成
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
};

// DB接続プールの作成
const pool = createPool(dbConfig);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await loadAllCommands();

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    const payload = Array.from(commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: payload });
    console.log('スラッシュコマンド登録完了');
  } catch (error) {
    console.error('コマンド登録エラー:', error);
  }

  // 初回キャッシュの生成（非同期でバックグラウンド実行）
  buildFallingCache().catch(err => {
    console.error('起動時キャッシュ生成エラー:', err);
  });

  // 各タスクの起動 (pool を渡す)
  startVotePartyTask(client, pool);
  startWatcherTask(pool);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    return interaction.reply({ 
      content: 'このコマンドは現在利用できないか、アンロードされています。', 
      flags: MessageFlags.Ephemeral 
    });
  }

  try {
    await command.execute(interaction, null, { dbConfig, pool });
  } catch (error) {
    console.error(`[Command Error] /${interaction.commandName}:`, error);

    // チャンネル側の権限不足エラー（Discord API Error: 50013）のハンドリング
    if (error.code === 50013) {
      try {
        await interaction.user.send(
          `⚠️ **【権限不足エラー】**\n` +
          `サーバー「**${interaction.guild?.name || '実行先のサーバー(申し訳ありません、取得に失敗しました。)'}**」の <#${interaction.channelId}> チャンネルで ` +
          `Botの実行権限（埋め込みリンクの送信など）が不足しているため、コマンド \`/${interaction.commandName}\` を処理できませんでした。\n` +
          `サーバー管理者へ権限の設定をご依頼ください。\n` +
          `-# 管理者向け情報\n` +
          `-# 必要な権限は以下の通りです。\n` +
          `-# | スラッシュコマンドの使用\n` +
          `-# | メッセージを送る\n` +
          `-# | メッセージ履歴を読む\n` +
          `-# | リンクを埋め込み\n`
        );
      } catch (dmError) {
        console.warn(`[DM Error] <@${interaction.user.id}> へのDM送信にも失敗しました（DM拒否設定など）:`, dmError.message);
      }
      return;
    }

    // その他の一般的なエラー時の処理
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        content: 'コマンドの実行中にエラーが発生しました。', 
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
});

// 毎日 JST 00:00:00 (UTC 15:00:00) に自動更新
cron.schedule('0 15 * * *', () => {
    console.log('[Cron] 定時キャッシュ更新を実行します...');
    buildFallingCache();
});

client.login(process.env.TOKEN);