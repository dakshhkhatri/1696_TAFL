import axios from 'axios';

const BASE_URL =
  process.env.REACT_APP_API_BASE_URL?.replace(/\/+$/, '') || '';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 15000,
});

function normalizeRegex(regex) {
  return regex.replace(/\+/g, '|');
}

export const convertRegex = async (regex) => {
  try {
    const normalized = normalizeRegex(regex);
    const res = await api.post('/convert', { regex: normalized });
    return res.data;
  } catch (err) {
    console.error('Convert API Error:', err);
    throw err;
  }
};

export const simulateInput = async (regex, input) => {
  try {
    const normalized = normalizeRegex(regex);
    const res = await api.post('/simulate', { regex: normalized, input });
    return res.data;
  } catch (err) {
    console.error('Simulation API Error:', err);
    throw err;
  }
};

