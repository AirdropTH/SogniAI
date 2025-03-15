const fs = require('fs').promises;
const axios = require('axios');
const chalk = require('chalk');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TOKEN_FILE = 'token.txt';
const PROXY_FILE = 'proxy.txt';
const CLAIM_ENDPOINT = 'https://api.sogni.ai/v2/account/reward/claim';
const REWARD_ENDPOINT = 'https://api.sogni.ai/v2/account/rewards';
const DAILY_BOOST_ID = '2';
const CHECK_INTERVAL_MINUTES = 60;
const CHECK_INTERVAL_MS = CHECK_INTERVAL_MINUTES * 60 * 1000;

function printBanner() {
  console.log(chalk.cyan('=================================================='));
  console.log(chalk.cyan('      Auto Claim Daily Bot Sogni Ai    '));
  console.log(chalk.cyan('=================================================='));
}

async function loadAccounts() {
  try {
    const token = await fs.readFile(TOKEN_FILE, 'utf8');
    return token.trim().split('\n').map(acc => acc.trim()).filter(acc => acc);
  } catch (error) {
    console.error(chalk.red('Error reading token file:', error.message));
    process.exit(1);
  }
}

async function loadProxies() {
  try {
    const data = await fs.readFile(PROXY_FILE, 'utf8');
    const proxyList = data.trim().split('\n').map(proxy => proxy.trim()).filter(proxy => proxy);
    console.log(chalk.green(`Loaded ${proxyList.length} proxies from ${PROXY_FILE}`));
    return proxyList;
  } catch (error) {
    console.warn(chalk.yellow('No proxies found or error loading proxies:', error.message));
    return [];
  }
}

function createProxyAgent(proxyUrl) {
  try {
    if (!proxyUrl) return null;
    const url = proxyUrl.toLowerCase();
    if (url.startsWith('socks4://') || url.startsWith('socks5://')) {
      return new SocksProxyAgent(proxyUrl);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      return new HttpsProxyAgent(proxyUrl);
    } else {
      return new HttpsProxyAgent(`http://${proxyUrl}`);
    }
  } catch (error) {
    console.error(chalk.red(`Error creating proxy agent for ${proxyUrl}: ${error.message}`));
    return null;
  }
}

function createAxiosInstance(proxyUrl = null) {
  const config = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
    timeout: 30000,
    maxRedirects: 5,
  };

  let proxyAgent = null;
  if (proxyUrl) {
    proxyAgent = createProxyAgent(proxyUrl);
    if (proxyAgent) {
      config.httpsAgent = proxyAgent;
      config.httpAgent = proxyAgent;
      console.log(chalk.green(`[${new Date().toISOString()}] Successfully created proxy agent for ${proxyUrl}`));
    } else {
      console.warn(chalk.yellow(`[${new Date().toISOString()}] Failed to create proxy agent for ${proxyUrl}, using direct connection.`));
    }
  } else {
    console.log(chalk.yellow(`[${new Date().toISOString()}] No proxy provided, using direct connection.`));
  }

  const instance = axios.create(config);

  instance.interceptors.response.use(
    response => response,
    async (error) => {
      const config = error.config;
      if (!config || config._retryCount >= (config.maxRetries || 3)) {
        return Promise.reject(error);
      }
      config._retryCount = (config._retryCount || 0) + 1;
      const delay = 1000 * Math.pow(2, config._retryCount - 1);
      console.log(chalk.yellow(`Retrying request (${config._retryCount}/3) after ${delay}ms...`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return instance(config);
    }
  );

  return instance;
}

async function checkRewardStatus(token, axiosInstance) {
  try {
    const response = await axiosInstance.get(REWARD_ENDPOINT, {
      headers: { 'authorization': token, 'Referer': 'https://app.sogni.ai/' },
    });
    if (response.data.status === 'success') {
      const dailyBoost = response.data.data.rewards.find(r => r.id === DAILY_BOOST_ID);
      if (dailyBoost?.canClaim === 1) return true;
      if (dailyBoost?.lastClaimTimestamp && dailyBoost.claimResetFrequencySec) {
        const nextAvailable = (dailyBoost.lastClaimTimestamp + dailyBoost.claimResetFrequencySec) * 1000;
        const timeLeft = nextAvailable - Date.now();
        if (timeLeft > 0) {
          const hours = Math.floor(timeLeft / (3600 * 1000));
          const minutes = Math.floor((timeLeft % (3600 * 1000)) / (60 * 1000));
          console.log(chalk.yellow(`[${new Date().toISOString()}] Next claim in ${hours}h ${minutes}m`));
        }
      }
    }
    return false;
  } catch (error) {
    console.error(chalk.red(`[${new Date().toISOString()}] Error checking reward: ${error.message}`));
    if (error.response) {
      console.error(chalk.red(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`));
    }
    return false;
  }
}

async function claimDailyBoost(token, axiosInstance) {
  try {
    const response = await axiosInstance.post(CLAIM_ENDPOINT, { claims: [DAILY_BOOST_ID] }, {
      headers: { 'authorization': token, 'Referer': 'https://app.sogni.ai/' },
    });
    if (response.data.status === 'success') {
      console.log(chalk.green(`[${new Date().toISOString()}] Daily boost claimed successfully!`));
      return true;
    }
    console.error(chalk.yellow(`[${new Date().toISOString()}] Failed to claim: ${response.data.message || 'Unknown error'}`));
    return false;
  } catch (error) {
    console.error(chalk.red(`[${new Date().toISOString()}] Error claiming boost: ${error.message}`));
    if (error.response) console.error(chalk.red(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`));
    return false;
  }
}

async function checkAndClaim(account, axiosInstance) {
  try {
    console.log(chalk.yellow(`\n🔐 Checking account ${account.slice(0, 5)}...`));
    const isClaimable = await checkRewardStatus(account, axiosInstance);
    if (isClaimable) {
      await claimDailyBoost(account, axiosInstance);
    } else {
      console.log(chalk.yellow(`[${new Date().toISOString()}] No claim available yet.`));
    }
  } catch (error) {
    console.error(chalk.red(`[${new Date().toISOString()}] Error in process: ${error.message}`));
  }
  setTimeout(() => checkAndClaim(account, axiosInstance), CHECK_INTERVAL_MS);
}

async function main() {
  printBanner();
  console.log(chalk.green(`[${new Date().toISOString()}] Starting Daily Boost Claim Bot...`));
  console.log(chalk.green(`[${new Date().toISOString()}] Checking every ${CHECK_INTERVAL_MINUTES} minutes.`));

  const [accounts, proxies] = await Promise.all([loadAccounts(), loadProxies()]);
  if (!accounts.length) throw new Error('No tokens found in token.txt');

  console.log(chalk.green(`📝 Loaded ${accounts.length} accounts`));
  if (proxies.length) {
    console.log(chalk.green(`🌐 Loaded ${proxies.length} proxies`));
  } else { 
    console.log(chalk.yellow(`🌐 No proxies, running in direct mode`));
  }

  accounts.forEach((account, index) => {
    const proxy = proxies[index % proxies.length] || null;
    const axiosInstance = createAxiosInstance(proxy);
    checkAndClaim(account, axiosInstance);
  });
}

main().catch(error => {
  console.error(chalk.red('❌ Critical error:', error.message));
  setTimeout(main, 60000); // Restart after 1 minute
});