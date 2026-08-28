import mysql from 'mysql2/promise';

/**
 * DB接続プールを作成
 */
export function createPool(dbConfig = {}) {
    return mysql.createPool({
        host: dbConfig.host || process.env.DB_HOST,
        port: Number(dbConfig.port || process.env.DB_PORT) || 3306,
        user: dbConfig.user || process.env.DB_USER,
        password: dbConfig.password || process.env.DB_PASS,
        database: dbConfig.database || process.env.DB_NAME,
        ssl: { rejectUnauthorized: false },
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}

/**
 * クエリ実行用汎用関数
 */
export async function query(pool, sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}