import cron from 'node-cron';
import axios from 'axios';

const ONLINE_API_URL = process.env.ONLINE_API_URL || 'https://api.earthmc.net/v4/online';

let cronTask = null;
let weeklyShiftTask = null;

function getCurrentDayIndex() {
    const today = new Date();
    return 28 + today.getDay(); // 直近の週（28〜34インデックス）
}

/**
 * 💡 週の切り替わり処理：配列を1週間分（7日分）左にずらして末尾に0を補充
 */
async function shiftWeeklyData(pool) {
    console.log('[Watcher] 週の切り替わり処理を開始します...');
    const sql = `
        UPDATE users SET counts = 
        JSON_ARRAY_APPEND(
            JSON_ARRAY_APPEND(JSON_ARRAY_APPEND(JSON_ARRAY_APPEND(JSON_ARRAY_APPEND(JSON_ARRAY_APPEND(JSON_ARRAY_APPEND(
                JSON_REMOVE(JSON_REMOVE(JSON_REMOVE(JSON_REMOVE(JSON_REMOVE(JSON_REMOVE(JSON_REMOVE(counts, '$[0]'), '$[0]'), '$[0]'), '$[0]'), '$[0]'), '$[0]'), '$[0]'),
            '$', 0), '$', 0), '$', 0), '$', 0), '$', 0), '$', 0), '$', 0)
    `;

    try {
        await pool.execute(sql);
        console.log('[Watcher] 全ユーザーの counts 配列を1週間分シフトしました！');
    } catch (error) {
        console.error('[Watcher] 週シフト処理エラー:', error);
    }
}

/**
 * 5分ごとのアクティビティ加算処理
 */
export async function runWatcherTask(pool) {
    if (!pool) return;

    try {
        const response = await axios.get(ONLINE_API_URL, { timeout: 10000 });
        const onlinePlayers = response.data.players;
        if (!Array.isArray(onlinePlayers) || onlinePlayers.length === 0) return;

        const targetIndex = getCurrentDayIndex();
        const initialCounts = JSON.stringify(new Array(35).fill(0));

        console.log(`[Watcher] ${onlinePlayers.length} 名のオンラインデータを処理中...`);

        const values = onlinePlayers.map(p => [p.uuid, initialCounts]);

        // users テーブルに対して BULK INSERT / UPSERT 実行
        const sql = `
            INSERT INTO users (mc_uuid, counts) 
            VALUES ?
            ON DUPLICATE KEY UPDATE 
                counts = IF(
                    JSON_LENGTH(counts) = 35, 
                    JSON_SET(
                        counts, 
                        '$[${targetIndex}]', 
                        CAST(JSON_EXTRACT(counts, '$[${targetIndex}]') AS UNSIGNED) + 1
                    ),
                    ?
                )
        `;

        await pool.query(sql, [values, initialCounts]);
        console.log('[Watcher] アクティビティログの更新が完了しました。');

    } catch (error) {
        console.error('[Watcher] 監視処理エラー:', error.message);
    }
}

/**
 * タスクの初期化とスケジュール登録
 */
export function startWatcherTask(pool) {
    // 5分ごとにオンラインプレイヤーのカウントを加算
    cronTask = cron.schedule('*/5 * * * *', () => runWatcherTask(pool));

    // 毎週日曜日 00:00 にデータの1週間分シフト
    weeklyShiftTask = cron.schedule('0 0 * * 0', () => shiftWeeklyData(pool));

    console.log('[Watcher] プレイヤーアクティビティ監視タスクを起動しました。');
}

/**
 * タスク停止用
 */
export function stopWatcherTask() {
    if (cronTask) cronTask.stop();
    if (weeklyShiftTask) weeklyShiftTask.stop();
    console.log('[Watcher] クロンタスクを停止しました。');
}