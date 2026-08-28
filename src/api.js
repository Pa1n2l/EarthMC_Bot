import fetch from 'node-fetch';
import process from 'process';

const BASE_URL = process.env.API || 'https://api.earthmc.net/v4/';

export async function fetchServerInfo() {
  const res = await fetch(`${BASE_URL}`); // Server Endpoint
  return await res.json();
}

export async function fetchPlayerData(playerName) {
  const res = await fetch(`${BASE_URL}players`, { // Players Endpoint
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: [playerName] })
  });
  const data = await res.json();
  return data[0] || null;
}

export async function fetchTownData(townName) {
  const res = await fetch(`${BASE_URL}towns`, { // Towns Endpoint
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: [townName] })
  });
  const data = await res.json();
  return data[0] || null;
}

export async function fetchNationData(nationName) {
  const res = await fetch(`${BASE_URL}nations`, { // Nations Endpoint
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: [nationName] })
  });
  const data = await res.json();
  return data[0] || null;
}

export async function fetchAllTowns() {
  const res = await fetch(`${BASE_URL}towns`); // GET全街取得
  return await res.json();
}