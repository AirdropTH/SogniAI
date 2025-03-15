const fs = require('fs');
const axios = require('axios');

const TOKEN_FILE = 'token.txt';
const CLAIM_ENDPOINT = 'https://api.sogni.ai/v2/account/reward/claim';
const REWARD_ENDPOINT = 'https://api.sogni.ai/v2/account/rewards';
const DAILY_BOOST_ID = '2';
const CHECK_INTERVAL_MINUTES = 60; 
const CHECK_INTERVAL_MS = CHECK_INTERVAL_MINUTES * 60 * 1000;

function printBanner() {
  console.log('==================================================');
  console.log('      Auto Claim Daily Bot Sogni Ai    ');
  console.log('==================================================');
}

async function getToken() {
  try {
    const token = await fs.promises.readFile(TOKEN_FILE, 'utf8');
    return token.trim();
  } catch (error) {
    console.error('Error reading token file:', error.message);
    process.exit(1);
  }
}

async function checkRewardStatus(token) {
  try {
    const response = await axios.get(REWARD_ENDPOINT, {
      headers: {
        'accept': '*/*',
        'authorization': token,
        'content-type': 'application/json',
        'Referer': 'https://app.sogni.ai/',
      }
    });

    if (response.data.status === 'success') {
      const rewards = response.data.data.rewards;
      const dailyBoost = rewards.find(reward => reward.id === DAILY_BOOST_ID);
      
      if (dailyBoost && dailyBoost.canClaim === 1) {
        return true;
      }
      
      if (dailyBoost && dailyBoost.lastClaimTimestamp && dailyBoost.claimResetFrequencySec) {
        const nextAvailableTime = (dailyBoost.lastClaimTimestamp + dailyBoost.claimResetFrequencySec) * 1000;
        const timeUntilAvailable = nextAvailableTime - Date.now();
        
        if (timeUntilAvailable > 0) {
          const hoursUntilAvailable = Math.floor(timeUntilAvailable / (60 * 60 * 1000));
          const minutesUntilAvailable = Math.floor((timeUntilAvailable % (60 * 60 * 1000)) / (60 * 1000));
          console.log(`[${new Date().toISOString()}] Next claim available in approximately ${hoursUntilAvailable} hours and ${minutesUntilAvailable} minutes`);
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking reward status:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

async function claimDailyBoost(token) {
  try {
    const response = await axios.post(CLAIM_ENDPOINT, 
      { claims: [DAILY_BOOST_ID] },
      {
        headers: {
          'accept': '*/*',
          'authorization': token,
          'content-type': 'application/json',
          'Referer': 'https://app.sogni.ai/',
        }
      }
    );

    if (response.data.status === 'success') {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Daily boost claimed successfully!`);
      return true;
    } else {
      console.error(`[${new Date().toISOString()}] Failed to claim: Unexpected response`, response.data);
      return false;
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error claiming daily boost:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

async function checkAndClaim() {
  try {
    const token = await getToken();
    const isClaimable = await checkRewardStatus(token);
    
    if (isClaimable) {
      await claimDailyBoost(token);
    } else {
      console.log(`[${new Date().toISOString()}] Daily boost not available for claiming yet.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in check and claim process:`, error.message);
  }
  
  setTimeout(checkAndClaim, CHECK_INTERVAL_MS);
}

printBanner();
console.log(`[${new Date().toISOString()}] Starting Daily Boost Claim Bot...`);
console.log(`[${new Date().toISOString()}] Bot will check for rewards every ${CHECK_INTERVAL_MINUTES} minutes.`);

checkAndClaim();