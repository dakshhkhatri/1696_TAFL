import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

/* convert classroom-style regex to backend regex
   UI uses:
   +  => OR
   *  => Kleene closure
*/
function normalizeRegex(regex) {
  return regex.replace(/\+/g, '|');
}

// Convert regex
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

// Simulate input
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

