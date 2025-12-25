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
const TOKEN_MINT = "7jJgmC1v8L55SfpSEVgEPZaN8NMv8d3rm8wXhN5Npump" || "";
const DEV_WALLET = process.env.DEV_WALLET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(RPC_URL, "confirmed");
const WALLET = Keypair.fromSecretKey(bs58.decode(WALLET_SECRET));

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getServerTimeInfo() {
  const now = new Date();
  const minutes = now.getMinutes();
  const INTERVAL_MS = 4 * 60 * 1000;

  const currentTimeMs = now.getTime();
  const remainderMs = currentTimeMs % INTERVAL_MS;

  const lastDistribution = new Date(currentTimeMs - remainderMs);
  const nextDistribution = new Date(lastDistribution.getTime() + INTERVAL_MS);

  const secondsUntilNext = Math.ceil(
    (nextDistribution.getTime() - currentTimeMs) / 1000
  );

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
  // Use Helius DAS API to get ALL token accounts
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  
  let allAccounts = [];
  let cursor = null;
  let page = 0;
  
  console.log(`Fetching ALL token holders for mint: ${mint}`);
  
  // Paginate through ALL token accounts
  do {
    page++;
    const requestBody = {
      jsonrpc: '2.0',
      id: 'helius-das',
      method: 'getTokenAccounts',
      params: {
        mint: mint,
        limit: 1000
      }
    };
    
    if (cursor) {
      requestBody.params.cursor = cursor;
    }
    
    console.log(`Fetching page ${page}...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`HTTP ${response.status}: ${text}`);
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      console.error('RPC Error:', data.error);
      throw new Error(`RPC error: ${data.error.message}`);
    }

    // Helius DAS response structure
    const result = data.result || {};
    const accounts = result.token_accounts || [];
    cursor = result.cursor || null;
    
    allAccounts = allAccounts.concat(accounts);
    
    console.log(`Page ${page}: ${accounts.length} accounts (total: ${allAccounts.length}), more: ${!!cursor}`);
    
  } while (cursor);

  console.log(`Total accounts fetched: ${allAccounts.length}`);

  if (allAccounts.length === 0) {
    throw new Error("No token accounts found");
  }

  // Filter: positive balance, exclude dev wallet
  let validAccounts = allAccounts
    .filter(account => {
      const balance = parseFloat(account.amount || '0');
      const owner = account.owner;
      return balance > 0 && owner && owner !== DEV_WALLET;
    })
    .map(account => ({
      owner: account.owner,
      balance: parseFloat(account.amount || '0')
    }))
    .sort((a, b) => b.balance - a.balance);

  console.log(`Valid holders after filtering: ${validAccounts.length}`);

  if (validAccounts.length === 0) {
    throw new Error("No valid token holders found");
  }

  // Log top 5 for debugging
  console.log('Top 5 holders:');
  validAccounts.slice(0, 5).forEach((acc, i) => {
    console.log(`  ${i + 1}. ${acc.owner}: ${acc.balance}`);
  });

  // Remove top holder (liquidity pool)
  const lpHolder = validAccounts[0];
  validAccounts = validAccounts.slice(1);
  console.log(`Removed LP: ${lpHolder.owner} (${lpHolder.balance} tokens)`);

  if (validAccounts.length === 0) {
    throw new Error("No eligible holders after removing LP");
  }

  // Calculate total supply for weighting
  const totalSupply = validAccounts.reduce((sum, acc) => sum + acc.balance, 0);
  console.log(`Total supply among ${validAccounts.length} eligible holders: ${totalSupply}`);

  // Build cumulative weights for weighted random selection
  let cumulative = 0;
  const weightedHolders = validAccounts.map(account => {
    const weight = account.balance / totalSupply;
    cumulative += weight;
    return {
      owner: account.owner,
      balance: account.balance,
      weight: weight,
      cumulativeWeight: cumulative
    };
  });

  // Pick random holder based on weight
  const random = Math.random();
  const selected = weightedHolders.find(h => random <= h.cumulativeWeight);

  if (!selected) {
    throw new Error("Failed to select holder");
  }

  console.log(`Random: ${random.toFixed(6)}`);
  console.log(`Winner: ${selected.owner}`);
  console.log(`  Balance: ${selected.balance}`);
  console.log(`  Weight: ${(selected.weight * 100).toFixed(4)}%`);

  return new PublicKey(selected.owner);
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
    console.log(`[CRON] ${timeInfo.serverTime} - Cycle ${timeInfo.currentCycle}`);

    // Check if already distributed this cycle
    const { data: existing, error: queryError } = await supabase
      .from('winners')
      .select('*')
      .eq('cycle_id', timeInfo.currentCycle)
      .limit(1);

    if (queryError) {
      console.error('Query error:', queryError);
    }

    if (existing && existing.length > 0) {
      console.log(`Already distributed for cycle ${timeInfo.currentCycle}`);
      return NextResponse.json({
        success: false,
        error: `Already distributed for cycle ${timeInfo.currentCycle}`,
        existingDistribution: existing[0],
        winners: await getRecentWinners(20),
        ...timeInfo
      });
    }

    console.log(`Starting distribution for cycle ${timeInfo.currentCycle}`);

    const balanceBefore = await connection.getBalance(WALLET.publicKey);
    
    const claimResult = await claimFees();
    await new Promise(r => setTimeout(r, 10000));

    const balanceAfter = await connection.getBalance(WALLET.publicKey);
    const claimedAmount = balanceAfter - balanceBefore;

    console.log(`Before: ${balanceBefore / 1e9} SOL`);
    console.log(`After: ${balanceAfter / 1e9} SOL`);
    console.log(`Claimed: ${claimedAmount / 1e9} SOL`);

    let recipient = null;
    let sig = null;
    let sendAmount = 0;

    if (claimedAmount > 5000) {
      sendAmount = claimedAmount - 5000000; // Keep 0.005 SOL for tx fee
      
      if (sendAmount > 0) {
        recipient = await getRandomHolder(TOKEN_MINT);
        sig = await sendSol(recipient, sendAmount);
        console.log(`Sent ${sendAmount / 1e9} SOL to ${recipient.toBase58()}`);
      }
    } else {
      console.log(`No meaningful fees to distribute`);
    }

    const winner = await saveWinnerWithCycle(
      recipient ? recipient.toBase58() : null,
      sendAmount / 1e9,
      sig,
      timeInfo.currentCycle
    );

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
    console.error(`Error:`, e);
    return NextResponse.json(
      { success: false, error: e.message, ...getServerTimeInfo() },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
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