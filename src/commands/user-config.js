import { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ComponentType, 
  MessageFlags 
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('user-config')
  .setDescription('自分の設定（崩壊アラート・VP通知・MCID連携）を管理します');

export async function execute(interaction, args, context = {}) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const pool = context.pool;

  // --- 設定データの取得関数 ---
  async function fetchUserData() {
    // 1. MCID 連携情報の取得
    const [linkRows] = await pool.execute('SELECT mcid FROM user_connections WHERE discord_id = ?', [userId]);
    const mcid = linkRows.length > 0 ? linkRows[0].mcid : null;

    // 2. VP通知設定の取得
    const [vpRows] = await pool.execute('SELECT enabled FROM user_vp_alerts WHERE discord_id = ?', [userId]);
    const vpEnabled = vpRows.length > 0 ? Boolean(vpRows[0].enabled) : false;

    // 3. 崩壊アラート（町・国）の取得
    const [townRows] = await pool.execute('SELECT town_name, user_ids FROM town_fall_alerts');
    const [nationRows] = await pool.execute('SELECT nation_name, user_ids FROM nation_fall_alerts');

    const alerts = [];
    for (const row of townRows) {
      const users = typeof row.user_ids === 'string' ? JSON.parse(row.user_ids) : row.user_ids;
      const found = users.find(u => u.UserID === userId);
      if (found) alerts.push({ type: 'town', name: row.town_name, time: found.NotifyTime });
    }
    for (const row of nationRows) {
      const users = typeof row.user_ids === 'string' ? JSON.parse(row.user_ids) : row.user_ids;
      const found = users.find(u => u.UserID === userId);
      if (found) alerts.push({ type: 'nation', name: row.nation_name, time: found.NotifyTime });
    }

    return { mcid, vpEnabled, alerts };
  }

  // --- UI レンダリング関数 ---
  async function renderUI() {
    const data = await fetchUserData();

    const embed = new EmbedBuilder()
      .setTitle('⚙️ ユーザー設定ダッシュボード')
      .setColor(0x3498db)
      .addFields(
        { 
          name: '👤 MCID 連携', 
          value: data.mcid ? `\`${data.mcid}\`` : '未連携', 
          inline: true 
        },
        { 
          name: '🎉 VP (Vote Party) 通知', 
          value: data.vpEnabled ? '🟢 **ON**' : '🔴 **OFF**', 
          inline: true 
        },
        { 
          name: `⚠️ 登録済み崩壊アラート (${data.alerts.length}件)`, 
          value: data.alerts.length > 0 
            ? data.alerts.map(a => `・[${a.type === 'town' ? '町' : '国'}] **${a.name}** (\`${a.time}\`)`).join('\n')
            : '登録されているアラートはありません。', 
          inline: false 
        }
      )
      .setFooter({ text: 'ボタンやドロップダウンから設定を変更できます' });

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_vp')
        .setLabel(data.vpEnabled ? 'VP通知を OFF にする' : 'VP通知を ON にする')
        .setStyle(data.vpEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('manage_link')
        .setLabel(data.mcid ? 'MCID 連携を解除' : 'MCID を連携する')
        .setStyle(data.mcid ? ButtonStyle.Secondary : ButtonStyle.Primary)
    );

    const components = [buttonRow];

    if (data.alerts.length > 0) {
      const options = data.alerts.map(a => ({
        label: `[${a.type === 'town' ? '町' : '国'}] ${a.name}`,
        description: `通知タイミング: ${a.time}`,
        value: `${a.type}:${a.name}`
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('delete_alert')
        .setPlaceholder('削除する崩壊アラートを選択...')
        .addOptions(options);

      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    return { embeds: [embed], components };
  }

  try {
    const initialPayload = await renderUI();
    const response = await interaction.editReply(initialPayload);

    const collector = response.createMessageComponentCollector({ time: 300000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId) {
        return i.reply({ content: '他のユーザーの設定画面は操作できません。', flags: MessageFlags.Ephemeral });
      }

      try {
        if (i.customId === 'toggle_vp') {
          await i.deferUpdate();
          const [rows] = await pool.execute('SELECT enabled FROM user_vp_alerts WHERE discord_id = ?', [userId]);
          const current = rows.length > 0 ? Boolean(rows[0].enabled) : false;

          await pool.execute(
            'INSERT INTO user_vp_alerts (discord_id, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = ?',
            [userId, !current, !current]
          );

          const updatedUI = await renderUI();
          await i.editReply(updatedUI);
        }
        else if (i.customId === 'manage_link') {
          const [linkRows] = await pool.execute('SELECT mcid FROM user_connections WHERE discord_id = ?', [userId]);
          
          if (linkRows.length > 0) {
            await i.deferUpdate();
            await pool.execute('DELETE FROM user_connections WHERE discord_id = ?', [userId]);
            const updatedUI = await renderUI();
            await i.editReply(updatedUI);
          } else {
            const modal = new ModalBuilder()
              .setCustomId('link_modal')
              .setTitle('Minecraft ID 連携');

            const mcidInput = new TextInputBuilder()
              .setCustomId('mcid_input')
              .setLabel('MCID (Minecraftのユーザー名)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(mcidInput));
            await i.showModal(modal);

            const submitted = await i.awaitModalSubmit({ time: 60000 }).catch(() => null);
            if (submitted) {
              await submitted.deferUpdate();
              const inputMcid = submitted.fields.getTextInputValue('mcid_input');
              
              await pool.execute(
                'INSERT INTO user_connections (discord_id, mcid) VALUES (?, ?) ON DUPLICATE KEY UPDATE mcid = ?',
                [userId, inputMcid, inputMcid]
              );

              const updatedUI = await renderUI();
              await submitted.editReply(updatedUI);
            }
          }
        }
        else if (i.customId === 'delete_alert') {
          await i.deferUpdate();
          const [type, name] = i.values[0].split(':');
          const tableName = type === 'town' ? 'town_fall_alerts' : 'nation_fall_alerts';
          const colName = type === 'town' ? 'town_name' : 'nation_name';

          const [rows] = await pool.execute(`SELECT user_ids FROM ${tableName} WHERE ${colName} = ?`, [name]);
          if (rows.length > 0) {
            let users = typeof rows[0].user_ids === 'string' ? JSON.parse(rows[0].user_ids) : rows[0].user_ids;
            users = users.filter(u => u.UserID !== userId);

            if (users.length === 0) {
              await pool.execute(`DELETE FROM ${tableName} WHERE ${colName} = ?`, [name]);
            } else {
              await pool.execute(`UPDATE ${tableName} SET user_ids = ? WHERE ${colName} = ?`, [JSON.stringify(users), name]);
            }
          }

          const updatedUI = await renderUI();
          await i.editReply(updatedUI);
        }
      } catch (interactionError) {
        console.error('[/user-config 操作時エラー]:', interactionError);
        const errorMsg = `❌ **操作中にエラーが発生しました**\n\`\`\`text\n${interactionError.stack || interactionError.message || interactionError}\n\`\`\``;
        if (i.deferred || i.replied) {
          await i.followUp({ content: errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
          await i.reply({ content: errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    });

    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });

  } catch (error) {
    console.error('[/user-config 実行エラー]:', error);
    
    // DBエラー時等のフォールバック出力
    const errorDetails = `❌ **データベースまたは処理エラーが発生しました**\n\`\`\`text\nCode: ${error.code || 'N/A'}\nMessage: ${error.sqlMessage || error.message}\nSQL: ${error.sql || 'N/A'}\n\`\`\``;
    
    await interaction.editReply({
      content: errorDetails,
      embeds: [],
      components: []
    }).catch(() => {});
  }
}