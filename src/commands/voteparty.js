import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { fetchServerInfo } from '../api.js';

export const data = new SlashCommandBuilder()
  .setName('vp')
  .setDescription('VotePartyの進捗状況を確認します');


function createProgressBar(numRemaining, target, totalBlocks = 20) {
  if (!target || target <= 0) return '░'.repeat(totalBlocks);
  
  const current = target - numRemaining;
  const percentage = Math.min(Math.max(current / target, 0), 1);
  
  const filledBlocks = Math.round(percentage * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;

  return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
}

function getProgressColor(numRemaining, target) {
    if (!target || target <= 0) return 0;
    const startR = 155;
    const startG = 89;
    const startB = 182;

    const endR = 241;
    const endG = 196;
    const endB = 15;

    const current = target - numRemaining;
    const ratio = Math.min(Math.max(current / target, 0), 1);

    const r = Math.round(startR + (endR - startR) * ratio);
    const g = Math.round(startG + (endG - startG) * ratio);
    const b = Math.round(startB + (endB - startB) * ratio);

    return (r << 16) + (g << 8) + b;
}

export async function execute(interaction) {
  const info = await fetchServerInfo();
  const vp = info.voteParty;
  
  const embed = new EmbedBuilder()
    .setTitle('🎉 VoteParty Status')
    .setDescription(`[${createProgressBar(vp.numRemaining, vp.target, 20)}] (${vp.target - vp.numRemaining}/${vp.target})`)
    .addFields(
        { name: '現在', value: `${vp.target - vp.numRemaining}`, inline: true },
        { name: '残り', value: `${vp.numRemaining}`, inline: true },
        { name: '必要数', value: `${vp.target}`, inline: true },
    )
    .setColor(getProgressColor(vp.numRemaining, vp.target));

  await interaction.reply({ embeds: [embed] });
}