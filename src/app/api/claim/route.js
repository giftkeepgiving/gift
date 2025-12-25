import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { createClient } from '@supabase/supabase-js';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMPPORTAL_API_KEY = process.env.PUMPPORTAL_API_KEY;
const WALLET_SECRET = process.env.WALLET_SECRET;
const TOKEN_MINT = "3DePXPZWmSEJUcXyKx7zGw1h6i9gUQGC6Pho3Pchpump" || ""; // Allow empty TOKEN_MINT
const DEV_WALLET = process.env.DEV_WALLET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(RPC_URL, "confirmed");
const WALLET = Keypair.fromSecretKey(bs58.decode(WALLET_SECRET));

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper function to get server time info for 4-minute cycles
function getServerTimeInfo() {
  const now = new Date();

  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();

  const INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

  const currentTimeMs = now.getTime();
  const remainderMs = currentTimeMs % INTERVAL_MS;

  const lastDistribution = new Date(currentTimeMs - remainderMs);
  const nextDistribution = new Date(lastDistribution.getTime() + INTERVAL_MS);

  const secondsUntilNext = Math.ceil(
    (nextDistribution.getTime() - currentTimeMs) / 1000
  );

  // Unique ID per 4-minute window
  const cycleId = Math.floor(currentTimeMs / INTERVAL_MS);

  return {
    serverTime: now.toISOString(),
    secondsUntilNext: Math.max(0, secondsUntilNext),
    nextDistributionTime: nextDistribution.toISOString(),
    lastDistributionTime: lastDistribution.toISOString(),
    currentCycle: cycleId,
    currentMinuteBucket: Math.floor(minutes / 4) * 4,
    tokenMintEmpty: !TOKEN_MINT || TOKEN_MINT.trim() === "",
  };
}

async function saveWinnerWithCycle(wallet, amount, signature, cycleId) {
  const { data, error } = await supabase
    .from('winners')
    .insert([
      {
        wallet: wallet || 'No fees',
        amount,
        signature,
        cycle_id: cycleId,
        distributed_at: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    console.error('Error saving winner:', error);
    throw error;
  }

  console.log(`Saved winner for cycle ${cycleId}:`, data[0]);
  return data[0];
}

async function getRecentWinners(limit = 20) {
  const { data, error } = await supabase
    .from('winners')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching winners:', error);
    throw error;
  }

  return data;
}

async function claimFees() {
  const response = await fetch(
    "https://pumpportal.fun/api/trade?api-key=" + PUMPPORTAL_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "collectCreatorFee",
        priorityFee: 0.000001,
        pool: "pump",
      }),
    }
  );
  return response.json();
}

async function getRandomHolder(mint) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  
  let allAccounts = [];
  let cursor = null;
  
  // Paginate through all token accounts using Helius DAS API
  do {
    const requestBody = {
      jsonrpc: '2.0',
      id: 'get-token-accounts',
      method: 'getTokenAccounts',
      params: {
        mint: mint,
        limit: 1000
      }
    };
    
    // Add cursor for pagination if we have one
    if (cursor) {
      requestBody.params.cursor = cursor;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch token accounts: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    const accounts = data.result?.token_accounts || [];
    allAccounts = allAccounts.concat(accounts);
    
    // Get cursor for next page
    cursor = data.result?.cursor || null;
    
    console.log(`Fetched ${accounts.length} accounts, total: ${allAccounts.length}, has more: ${!!cursor}`);
    
  } while (cursor);

  if (allAccounts.length === 0) {
    throw new Error("No token accounts found");
  }

  console.log(`Total token accounts found: ${allAccounts.length}`);

  // Filter accounts with positive balance and exclude dev wallet
  let validAccounts = allAccounts
    .filter(account => {
      const balance = parseFloat(account.amount || '0');
      const owner = account.owner;
      
      // Exclude accounts with zero balance or dev wallet
      return balance > 0 && owner !== DEV_WALLET;
    })
    .map(account => ({
      owner: account.owner,
      balance: parseFloat(account.amount || '0')
    }))
    .sort((a, b) => b.balance - a.balance); // Sort descending by balance

  console.log(`Valid accounts after filtering: ${validAccounts.length}`);

  if (validAccounts.length === 0) {
    throw new Error("No token holders with positive balance found (excluding dev wallet)");
  }

  // Log top holders for debugging
  console.log('Top 5 holders:');
  validAccounts.slice(0, 5).forEach((acc, i) => {
    console.log(`  ${i + 1}. ${acc.owner}: ${acc.balance}`);
  });

  // Remove the top holder (liquidity pool)
  const removedHolder = validAccounts[0];
  validAccounts = validAccounts.slice(1);
  console.log(`Removed top holder (likely LP): ${removedHolder.owner} with ${removedHolder.balance} tokens`);
  
  if (validAccounts.length === 0) {
    throw new Error("No eligible holders found (only liquidity pool and/or dev wallet detected)");
  }

  // Calculate total supply among eligible holders
  const totalSupply = validAccounts.reduce((sum, account) => sum + account.balance, 0);
  console.log(`Total supply among eligible holders: ${totalSupply}`);
  
  // Create weighted selection based on token holdings
  const weightedHolders = validAccounts.map(account => ({
    owner: account.owner,
    balance: account.balance,
    weight: account.balance / totalSupply,
    cumulativeWeight: 0
  }));

  // Calculate cumulative weights for selection
  let cumulativeWeight = 0;
  for (let i = 0; i < weightedHolders.length; i++) {
    cumulativeWeight += weightedHolders[i].weight;
    weightedHolders[i].cumulativeWeight = cumulativeWeight;
  }

  // Generate random number between 0 and 1
  const random = Math.random();
  
  // Find the holder based on weighted random selection
  const selectedHolder = weightedHolders.find(holder => random <= holder.cumulativeWeight);
  
  if (!selectedHolder || !selectedHolder.owner) {
    throw new Error("Failed to select weighted random holder");
  }

  console.log(`Random value: ${random}`);
  console.log(`Selected holder: ${selectedHolder.owner}`);
  console.log(`  Balance: ${selectedHolder.balance} tokens`);
  console.log(`  Weight: ${(selectedHolder.weight * 100).toFixed(4)}% of eligible supply`);

  return new PublicKey(selectedHolder.owner);
}

async function sendSol(recipient, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: WALLET.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [WALLET]);
  return sig;
}

export async function GET() {
  try {
    // Check if TOKEN_MINT is empty
    if (!TOKEN_MINT || TOKEN_MINT.trim() === "") {
      return NextResponse.json({
        success: false,
        error: "TOKEN_MINT not configured",
        tokenMintEmpty: true,
        winners: [],
        ...getServerTimeInfo()
      });
    }

    const timeInfo = getServerTimeInfo();
    console.log(`[CRON] ${timeInfo.serverTime} - Starting distribution check for cycle ${timeInfo.currentCycle}`);
    
    // Check if we already distributed in this exact 4-minute cycle
    const { data: existingDistribution, error: queryError } = await supabase
      .from('winners')
      .select('*')
      .eq('cycle_id', timeInfo.currentCycle)
      .limit(1);

    if (queryError) {
      console.error('Error checking existing distribution:', queryError);
    }

    if (existingDistribution && existingDistribution.length > 0) {
      console.log(`Distribution already completed for cycle ${timeInfo.currentCycle}`);
      return NextResponse.json({
        success: false,
        error: `Distribution already completed for cycle ${timeInfo.currentCycle}`,
        existingDistribution: existingDistribution[0],
        winners: await getRecentWinners(20),
        ...timeInfo
      });
    }

    console.log(`Starting distribution for cycle ${timeInfo.currentCycle} at ${timeInfo.serverTime}`);

    // Get wallet balance before claiming fees
    const balanceBefore = await connection.getBalance(WALLET.publicKey);
    
    const claimResult = await claimFees();
    await new Promise((r) => setTimeout(r, 10_000));

    // Get wallet balance after claiming fees
    const balanceAfter = await connection.getBalance(WALLET.publicKey);
    
    // Calculate the amount of SOL claimed from fees
    const claimedAmount = balanceAfter - balanceBefore;
    
    console.log(`Cycle ${timeInfo.currentCycle} - Balance before: ${balanceBefore / 1e9} SOL`);
    console.log(`Cycle ${timeInfo.currentCycle} - Balance after: ${balanceAfter / 1e9} SOL`);
    console.log(`Cycle ${timeInfo.currentCycle} - Claimed from fees: ${claimedAmount / 1e9} SOL`);

    let recipient = null;
    let sig = null;
    let sendAmount = 0;
    
    // Only send if we actually claimed some fees (and it's a meaningful amount)
    if (claimedAmount > 5000) { // Only distribute if claimed amount > 0.000005 SOL
      sendAmount = claimedAmount - 5000000; // Keep 0.005 SOL for transaction fee
      
      if (sendAmount > 0) {
        recipient = await getRandomHolder(TOKEN_MINT);
        sig = await sendSol(recipient, sendAmount);
        console.log(`Cycle ${timeInfo.currentCycle} - Sent ${sendAmount / 1e9} SOL to ${recipient.toBase58()}`);
      }
    } else {
      console.log(`Cycle ${timeInfo.currentCycle} - No meaningful fees to distribute (${claimedAmount / 1e9} SOL)`);
    }

    // Save winner to database with cycle ID (even if amount is 0 for transparency)
    const winner = await saveWinnerWithCycle(
      recipient ? recipient.toBase58() : null,
      sendAmount / 1e9, // in SOL
      sig,
      timeInfo.currentCycle
    );

    // Get recent winners for response
    const winners = await getRecentWinners(20);

    return NextResponse.json({
      success: true,
      cycleId: timeInfo.currentCycle,
      claimResult,
      recipient: recipient ? recipient.toBase58() : null,
      balanceBefore: balanceBefore / 1e9,
      balanceAfter: balanceAfter / 1e9,
      claimedFromFees: claimedAmount / 1e9,
      forwardedLamports: sendAmount,
      forwardedSOL: sendAmount / 1e9,
      txSignature: sig,
      winner,
      winners,
      ...timeInfo
    });
  } catch (e) {
    console.error(`Error in GET handler for cycle ${getServerTimeInfo().currentCycle}:`, e);
    return NextResponse.json(
      { success: false, error: e.message, ...getServerTimeInfo() },
      { status: 500 }
    );
  }
}

// Get winners from database + server time info
export async function POST() {
  try {
    // Check if TOKEN_MINT is empty
    if (!TOKEN_MINT || TOKEN_MINT.trim() === "") {
      return NextResponse.json({
        success: false,
        error: "TOKEN_MINT not configured",
        tokenMintEmpty: true,
        winners: [],
        ...getServerTimeInfo()
      });
    }

    const winners = await getRecentWinners(20);
    return NextResponse.json({ 
      winners,
      ...getServerTimeInfo()
    });
  } catch (e) {
    console.error("Error fetching winners:", e);
    return NextResponse.json(
      { success: false, error: e.message, ...getServerTimeInfo() },
      { status: 500 }
    );
  }
}