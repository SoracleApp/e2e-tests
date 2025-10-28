const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("--- Market Lifecycle Simulation (Separated Roles) ---");

  // === Setup ===
  // owner: Settles market
  // marketCreator: Provides LP
  // user1, user2, user3: Traders
  const [owner, marketCreator, user1, user2, user3] = await ethers.getSigners(); 
  const traders = { user1, user2, user3 }; // Only traders for PNL
  const collateralDecimals = 6; // Like USDC
  const oneToken = ethers.parseUnits("1", collateralDecimals);

  // Store initial balances for PNL (only for traders)
  const initialCollateralBalances = {};
  for (const name in traders) {
    initialCollateralBalances[name] = 0n; // Start at 0 before minting
  }

  console.log("\nDeploying contracts...");
  // Deploy MockERC20
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockERC20 = await MockERC20.deploy("USD Coin", "USDC", collateralDecimals);
  console.log(`MockERC20 deployed to: ${mockERC20.target}`);

  // Deploy PythagoreanBondingCurve library
  const PythagoreanBondingCurve = await ethers.getContractFactory("PythagoreanBondingCurve");
  const pythagoreanBondingCurve = await PythagoreanBondingCurve.deploy();
  console.log(`PythagoreanBondingCurve deployed to: ${pythagoreanBondingCurve.target}`);

  // Deploy PNPFactory
  const PNPFactory = await ethers.getContractFactory("PNPFactory", {
    libraries: { PythagoreanBondingCurve: pythagoreanBondingCurve.target },
  });
  const pnpFactory = await PNPFactory.deploy("https://api.example.com/");
  console.log(`PNPFactory deployed to: ${pnpFactory.target}`);

  // Fund users and approve factory
  console.log("\nFunding users and approving factory...");
  // Fund traders
  await mockERC20.mint(user1.address, oneToken * 100000n);
  initialCollateralBalances.user1 += oneToken * 100000n;
  await mockERC20.mint(user2.address, oneToken * 100000n); 
  initialCollateralBalances.user2 += oneToken * 100000n;
  await mockERC20.mint(user3.address, oneToken * 100000n); 
  initialCollateralBalances.user3 += oneToken * 100000n;
  // Fund marketCreator just enough for LP
  const initialLiquidity = oneToken * 5000n; // 5k USDC liquidity
  await mockERC20.mint(marketCreator.address, initialLiquidity);

  // Approve factory for traders and marketCreator
  // Owner doesn't need approval as settleMarket requires no tokens
  await mockERC20.connect(marketCreator).approve(pnpFactory.target, initialLiquidity);
  for (const name in traders) {
      await mockERC20.connect(traders[name]).approve(pnpFactory.target, ethers.MaxUint256);
  }

  // === Market Creation by marketCreator ===
  console.log("\nCreating prediction market (marketCreator as LP)...");
  const question = "Will User 1 and User 3 win this market?";
  const block = await ethers.provider.getBlock('latest');
  const endTime = block.timestamp + 60 * 60 * 24; // 1 day from now

  // marketCreator provides initial liquidity
  const createTx = await pnpFactory.connect(marketCreator).createPredictionMarket(
    initialLiquidity,
    mockERC20.target,
    question,
    endTime
  );
  const receiptCreate = await createTx.wait();
  const createdEvent = receiptCreate.logs.find(log => pnpFactory.interface.parseLog(log)?.name === "PNP_MarketCreated");
  const conditionId = pnpFactory.interface.parseLog(createdEvent).args.conditionId;
  const yesTokenId = await pnpFactory.getYesTokenId(conditionId);
  const noTokenId = await pnpFactory.getNoTokenId(conditionId);

  console.log(`Market created by marketCreator (${marketCreator.address.substring(0,6)}...) with conditionId: ${conditionId}`);
  console.log(`  Initial Liquidity: ${ethers.formatUnits(initialLiquidity, collateralDecimals)}`);
  console.log(`  YES Token ID: ${yesTokenId}`);
  console.log(`  NO Token ID: ${noTokenId}`);

  // === Initial State & Price Check ===
  console.log("\nChecking initial market state (after LP)...");
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  // === Trading (No Burning) ===
  console.log("\nSimulating trading...");
  const user1MintYesAmount = oneToken * 3000n; // User1 buys 3k YES
  const user2MintNoAmount = oneToken * 2000n;  // User2 buys 2k NO
  const user3MintYesAmount = oneToken * 1000n; // User3 buys 1k YES
  
  console.log(`\nUser1 minting YES tokens with ${ethers.formatUnits(user1MintYesAmount, collateralDecimals)} collateral...`);
  let tx = await pnpFactory.connect(user1).mintDecisionTokens(conditionId, user1MintYesAmount, yesTokenId);
  let receipt = await tx.wait();
  let mintEvent = receipt.logs.findLast(log => pnpFactory.interface.parseLog(log)?.name === "PNP_DecisionTokensMinted");
  let mintedAmount = mintEvent ? pnpFactory.interface.parseLog(mintEvent).args.amount : 0n;
  console.log(`  -> Minted ${ethers.formatUnits(mintedAmount, 18)} YES tokens.`);
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  console.log(`\nUser2 minting NO tokens with ${ethers.formatUnits(user2MintNoAmount, collateralDecimals)} collateral...`);
  tx = await pnpFactory.connect(user2).mintDecisionTokens(conditionId, user2MintNoAmount, noTokenId);
  receipt = await tx.wait();
  mintEvent = receipt.logs.findLast(log => pnpFactory.interface.parseLog(log)?.name === "PNP_DecisionTokensMinted");
  mintedAmount = mintEvent ? pnpFactory.interface.parseLog(mintEvent).args.amount : 0n;
  console.log(`  -> Minted ${ethers.formatUnits(mintedAmount, 18)} NO tokens.`);
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  console.log(`\nUser3 minting YES tokens with ${ethers.formatUnits(user3MintYesAmount, collateralDecimals)} collateral...`);
  tx = await pnpFactory.connect(user3).mintDecisionTokens(conditionId, user3MintYesAmount, yesTokenId);
  receipt = await tx.wait();
  mintEvent = receipt.logs.findLast(log => pnpFactory.interface.parseLog(log)?.name === "PNP_DecisionTokensMinted");
  mintedAmount = mintEvent ? pnpFactory.interface.parseLog(mintEvent).args.amount : 0n;
  console.log(`  -> Minted ${ethers.formatUnits(mintedAmount, 18)} YES tokens.`);
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  // === Settlement (YES Wins) ===
  console.log("\nSettling market (YES wins)...");
  // Fast forward time
  console.log("Fast forwarding time past market end...");
  await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
  await ethers.provider.send("evm_mine");

  const winningOutcome = yesTokenId; 
  // Owner settles the market
  console.log(`Owner (${owner.address.substring(0,6)}...) settling market with winning outcome: YES (${winningOutcome})`); 
  const settleTx = await pnpFactory.connect(owner).settleMarket(conditionId, winningOutcome);
  await settleTx.wait(); 
  console.log("Market settled.");

  // Verify settlement state
  const isSettled = await pnpFactory.marketSettled(conditionId);
  const actualWinningTokenId = await pnpFactory.winningTokenId(conditionId);
  if (isSettled && actualWinningTokenId === winningOutcome) {
    console.log("Settlement state verified successfully.");
  } else {
    console.error("Settlement state verification failed!");
    process.exitCode = 1; return;
  }

  // === Post-Settlement State ===
  console.log("\nChecking post-settlement market state...");
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals, true);

  // === Redemption ===
  console.log("\nSimulating redemption...");
  
  // Winners redeem
  await redeemAndLog(pnpFactory, mockERC20, user1, conditionId, "User1 (YES Buyer)", collateralDecimals);
  await redeemAndLog(pnpFactory, mockERC20, user3, conditionId, "User3 (YES Buyer)", collateralDecimals);
  // marketCreator redeems their LP share
  await redeemAndLog(pnpFactory, mockERC20, marketCreator, conditionId, "marketCreator (LP)", collateralDecimals); 

  // User2 (bought NO) attempts to redeem losing tokens
  const user2LosingBalance = await pnpFactory.balanceOf(user2.address, noTokenId);
  const user2WinningBalance = await pnpFactory.balanceOf(user2.address, yesTokenId);

  console.log(`\nUser2 attempting to redeem...`);
  console.log(`  User2 Losing (NO) Token Balance: ${ethers.formatUnits(user2LosingBalance, 18)}`);
  console.log(`  User2 Winning (YES) Token Balance: ${ethers.formatUnits(user2WinningBalance, 18)}`);
  if (user2LosingBalance > 0 && user2WinningBalance == 0) { // User2 only holds losing tokens
      try {
        await pnpFactory.connect(user2).redeemPosition(conditionId);
        console.error("Error: User2 redemption did not revert as expected.");
        process.exitCode = 1;
      } catch (error) {
        if (error.message.includes("No winning tokens to redeem")) {
          console.log("User2 redemption call correctly reverted with 'No winning tokens to redeem'.");
        } else {
          console.error("User2 redemption reverted with unexpected error:", error.message);
          process.exitCode = 1;
        }
      }
  } else if (user2WinningBalance > 0) {
       console.log("User2 holds some winning tokens, attempting redemption...");
       await redeemAndLog(pnpFactory, mockERC20, user2, conditionId, "User2 (Mixed Holder)", collateralDecimals);
  } else {
      console.log("User2 has no tokens to redeem.");
  }

  // === PNL Calculation ===
  console.log("\n--- Calculating PNL (Traders Only) --- ");
  const finalCollateralBalances = {};
  // Calculate PNL only for traders (user1, user2, user3)
  for (const name in traders) {
      finalCollateralBalances[name] = await mockERC20.balanceOf(traders[name].address);
      const pnl = finalCollateralBalances[name] - initialCollateralBalances[name];
      console.log(`  ${name}:`);
      console.log(`    Initial Collateral: ${ethers.formatUnits(initialCollateralBalances[name], collateralDecimals)}`);
      console.log(`    Final Collateral:   ${ethers.formatUnits(finalCollateralBalances[name], collateralDecimals)}`);
      console.log(`    PNL:                ${ethers.formatUnits(pnl, collateralDecimals)}`);
  }
  // Log owner and marketCreator balances just for info, not PNL
  const ownerFinalBalance = await mockERC20.balanceOf(owner.address);
  const marketCreatorFinalBalance = await mockERC20.balanceOf(marketCreator.address);
  console.log(`\n  --- Other Balances (Info) ---`); 
  console.log(`  Owner Final Balance:           ${ethers.formatUnits(ownerFinalBalance, collateralDecimals)}`); 
  console.log(`  marketCreator Final Balance:   ${ethers.formatUnits(marketCreatorFinalBalance, collateralDecimals)}`); 


  console.log("\n--- Simulation Complete ---");
}

// Helper function to log market state
async function logMarketState(factory, conditionId, yesId, noId, collateralDecimals, settled = false) {
  const reserveRaw = await factory.marketReserve(conditionId);
  // Explicitly use the function signature to resolve ambiguity
  const yesSupply = await factory["totalSupply(uint256)"](yesId);
  const noSupply = await factory["totalSupply(uint256)"](noId);
  const yesPrice = await factory.getMarketPrice(conditionId, yesId);
  const noPrice = await factory.getMarketPrice(conditionId, noId);

  console.log(`  Market Reserve: ${ethers.formatUnits(reserveRaw, 18)} (scaled)`);
  console.log(`  YES Supply: ${ethers.formatUnits(yesSupply, 18)}`);
  console.log(`  NO Supply: ${ethers.formatUnits(noSupply, 18)}`);
  console.log(`  YES Price: ${ethers.formatUnits(yesPrice, 18)} collateral/token`);
  console.log(`  NO Price: ${ethers.formatUnits(noPrice, 18)} collateral/token`);
  if (settled) {
      const winningId = await factory.winningTokenId(conditionId);
      console.log(`  Settled: YES, Winning Token ID: ${winningId} (${winningId == yesId ? 'YES' : 'NO'})`);
  }
}

// Helper function to redeem and log
async function redeemAndLog(factory, collateralToken, user, conditionId, userName, collateralDecimals) {
    const winningTokenId = await factory.winningTokenId(conditionId);
    const initialBalance = await factory.balanceOf(user.address, winningTokenId);
    const initialCollateralUser = await collateralToken.balanceOf(user.address);
    const initialCollateralFactory = await collateralToken.balanceOf(factory.target);
    console.log(`\n${userName} redeeming ${ethers.formatUnits(initialBalance, 18)} winning tokens...`);
    console.log(`  (Factory collateral before: ${ethers.formatUnits(initialCollateralFactory, collateralDecimals)})`);
    if (initialBalance == 0n) {
        console.log(`${userName} has no winning tokens to redeem.`);
        return 0n; // Return 0 change if no redemption
    }
    let collateralChange = 0n;
    try {
        const redeemTx = await factory.connect(user).redeemPosition(conditionId);
        const receipt = await redeemTx.wait();
        const redeemedEvent = receipt.logs.findLast(log => factory.interface.parseLog(log)?.name === "PNP_PositionRedeemed");
        // Handle cases where redeemedEvent might not be found if redemption yields 0
        const redeemedAmount = redeemedEvent ? factory.interface.parseLog(redeemedEvent).args.amount : 0n;
        
        const finalBalance = await factory.balanceOf(user.address, winningTokenId);
        const finalCollateralUser = await collateralToken.balanceOf(user.address);
        collateralChange = finalCollateralUser - initialCollateralUser;

        console.log(`${userName} redeemed successfully!`);
        console.log(`  Tokens Redeemed: ${ethers.formatUnits(initialBalance, 18)}`);
        console.log(`  Collateral Received: ${ethers.formatUnits(redeemedAmount, collateralDecimals)}`);
        console.log(`  Remaining Token Balance: ${ethers.formatUnits(finalBalance, 18)}`);
        console.log(`  Collateral Change: +${ethers.formatUnits(collateralChange, collateralDecimals)}`);
    } catch (error) {
        console.error(`${userName} redemption failed:`, error.message);
    }
    return collateralChange; // Return the change in collateral
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 
