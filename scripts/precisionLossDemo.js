const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("--- Precision Loss Demonstration ---");

  // === Setup ===
  const [owner, lpProvider, user1, user2] = await ethers.getSigners();
  const collateralDecimals = 2; // LOW DECIMALS to exaggerate effects
  const oneToken = ethers.parseUnits("1", collateralDecimals);
  const smallestUnit = ethers.parseUnits("0.01", collateralDecimals); // 1 cent

  console.log(`Using collateral with ${collateralDecimals} decimals.`);
  console.log(`Smallest collateral unit: ${smallestUnit} wei`);

  console.log("\nDeploying contracts...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockERC20 = await MockERC20.deploy("LowDecimalCoin", "LDC", collateralDecimals);
  const PythagoreanBondingCurve = await ethers.getContractFactory("PythagoreanBondingCurve");
  const pythagoreanBondingCurve = await PythagoreanBondingCurve.deploy();
  const PNPFactory = await ethers.getContractFactory("PNPFactory", {
    libraries: { PythagoreanBondingCurve: pythagoreanBondingCurve.target },
  });
  const pnpFactory = await PNPFactory.deploy("https://api.example.com/");

  // Fund users
  await mockERC20.mint(lpProvider.address, oneToken * 1000n); // 1000 LDC for LP
  await mockERC20.mint(user1.address, oneToken * 100n);      // 100 LDC for User1
  await mockERC20.mint(user2.address, oneToken * 100n);      // 100 LDC for User2

  // Approve factory
  await mockERC20.connect(lpProvider).approve(pnpFactory.target, ethers.MaxUint256);
  await mockERC20.connect(user1).approve(pnpFactory.target, ethers.MaxUint256);
  await mockERC20.connect(user2).approve(pnpFactory.target, ethers.MaxUint256);

  // === Market Creation ===
  console.log("\nCreating market...");
  const initialLiquidity = oneToken * 100n; // 100 LDC
  const block = await ethers.provider.getBlock('latest');
  const endTime = block.timestamp + 60 * 60 * 24;
  const createTx = await pnpFactory.connect(lpProvider).createPredictionMarket(
    initialLiquidity, mockERC20.target, "Precision Test Market", endTime
  );
  const receiptCreate = await createTx.wait();
  const createdEvent = receiptCreate.logs.find(log => pnpFactory.interface.parseLog(log)?.name === "PNP_MarketCreated");
  const conditionId = pnpFactory.interface.parseLog(createdEvent).args.conditionId;
  const yesTokenId = await pnpFactory.getYesTokenId(conditionId);
  const noTokenId = await pnpFactory.getNoTokenId(conditionId);
  console.log("Market created.");
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  // === Test 1: Tiny Mint & Burn ===
  console.log("\n--- Test 1: Tiny Mint & Burn ---");
  const mintAmountTiny = smallestUnit; // 0.01 LDC
  console.log(`User1 minting YES with smallest unit: ${ethers.formatUnits(mintAmountTiny, collateralDecimals)} LDC`);
  
  // Estimate scaled amounts (can't see internal vars directly)
  const scaledFullAmountTiny = (mintAmountTiny * (10n ** 18n)) / (10n ** BigInt(collateralDecimals));
  const fee = await pnpFactory.TAKE_FEE();
  const amountAfterFeeTiny = (mintAmountTiny * (10000n - fee)) / 10000n;
  const scaledAmountAfterFeeTiny = (amountAfterFeeTiny * (10n ** 18n)) / (10n ** BigInt(collateralDecimals));
  console.log(`  -> Estimated Scaled Collateral (Full): ${ethers.formatUnits(scaledFullAmountTiny, 18)}`);
  console.log(`  -> Estimated Scaled Collateral (After Fee): ${ethers.formatUnits(scaledAmountAfterFeeTiny, 18)}`);

  const txMintTiny = await pnpFactory.connect(user1).mintDecisionTokens(conditionId, mintAmountTiny, yesTokenId);
  const receiptMintTiny = await txMintTiny.wait();
  const mintEventTiny = receiptMintTiny.logs.findLast(log => pnpFactory.interface.parseLog(log)?.name === "PNP_DecisionTokensMinted");
  const mintedAmountTiny = mintEventTiny ? pnpFactory.interface.parseLog(mintEventTiny).args.amount : 0n;
  console.log(`  -> Actual Minted Tokens: ${ethers.formatUnits(mintedAmountTiny, 18)} YES`);

  if (mintedAmountTiny > 0) {
    console.log(`\nUser1 burning ALL ${ethers.formatUnits(mintedAmountTiny, 18)} YES tokens immediately...`);
    const initialCollateralBalBurn = await mockERC20.balanceOf(user1.address);
    const txBurnTiny = await pnpFactory.connect(user1).burnDecisionTokens(conditionId, yesTokenId, mintedAmountTiny);
    const receiptBurnTiny = await txBurnTiny.wait();
    const burnEventTiny = receiptBurnTiny.logs.findLast(log => pnpFactory.interface.parseLog(log)?.name === "PNP_DecisionTokenBurned"); // Event doesn't show collateral amount
    const finalCollateralBalBurn = await mockERC20.balanceOf(user1.address);
    const collateralReturned = finalCollateralBalBurn - initialCollateralBalBurn;
    console.log(`  -> Collateral Returned: ${ethers.formatUnits(collateralReturned, collateralDecimals)} LDC`);
    console.log(`  -> Initial Input vs Output Diff: ${ethers.formatUnits(mintAmountTiny - collateralReturned, collateralDecimals)} LDC`);
    if (mintAmountTiny > collateralReturned) {
      console.log("  -> PRECISION LOSS DETECTED (Burn returned less than Mint input)");
    } else if (mintAmountTiny < collateralReturned) {
       console.log("  -> UNEXPECTED GAIN? (Burn returned more than Mint input - Check Logic!)");
    }
  } else {
    console.log("  -> Mint resulted in 0 tokens, cannot burn.");
  }
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  // === Test 2: Small Fee Impact ===
  console.log("\n--- Test 2: Small Fee Impact --- ");
  const mintAmountSmall = oneToken; // 1.00 LDC
  console.log(`User2 minting NO with small amount: ${ethers.formatUnits(mintAmountSmall, collateralDecimals)} LDC`);
  const user2BalBefore = await mockERC20.balanceOf(user2.address);
  const txMintSmall = await pnpFactory.connect(user2).mintDecisionTokens(conditionId, mintAmountSmall, noTokenId);
  const receiptMintSmall = await txMintSmall.wait();
  const user2BalAfter = await mockERC20.balanceOf(user2.address);
  const mintEventSmall = receiptMintSmall.logs.findLast(log => pnpFactory.interface.parseLog(log)?.name === "PNP_DecisionTokensMinted");
  const mintedAmountSmall = mintEventSmall ? pnpFactory.interface.parseLog(mintEventSmall).args.amount : 0n;
  console.log(`  -> Actual Cost to User2: ${ethers.formatUnits(user2BalBefore - user2BalAfter, collateralDecimals)} LDC`);
  console.log(`  -> Actual Minted Tokens: ${ethers.formatUnits(mintedAmountSmall, 18)} NO`);
  await logMarketState(pnpFactory, conditionId, yesTokenId, noTokenId, collateralDecimals);

  // === Test 3: Redemption Dust ===
  console.log("\n--- Test 3: Redemption Dust --- ");
  console.log("Settling market (YES wins)...");
  await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
  await ethers.provider.send("evm_mine");
  await pnpFactory.connect(owner).settleMarket(conditionId, yesTokenId);
  console.log("Market settled.");
  
  // User1 might have a tiny YES balance left from the first mint/burn if loss occurred
  const user1FinalYesBalance = await pnpFactory.balanceOf(user1.address, yesTokenId);
  console.log(`User1 attempting to redeem remaining YES balance: ${ethers.formatUnits(user1FinalYesBalance, 18)}`);
  if (user1FinalYesBalance > 0) {
    const redeemedInfo = await redeemAndLog(pnpFactory, mockERC20, user1, conditionId, "User1 (Dust Check)", collateralDecimals);
    if (redeemedInfo.collateralReceivedWei == 0n) {
        console.log(`  -> Redeemed 0 collateral. scaleFrom18Decimals likely truncated the small amount.`);
    } else {
        console.log(`  -> Redeemed > 0 collateral.`);
    }
  } else {
    console.log("  User1 has zero YES balance left.");
  }

  console.log("\n--- Precision Demo Complete ---");
}

// Helper functions (logMarketState, redeemAndLog) - slightly modified redeem
async function logMarketState(factory, conditionId, yesId, noId, collateralDecimals, settled = false) {
    const reserveRaw = await factory.marketReserve(conditionId);
    const yesSupply = await factory["totalSupply(uint256)"](yesId);
    const noSupply = await factory["totalSupply(uint256)"](noId);
    console.log(`  Market Reserve: ${ethers.formatUnits(reserveRaw, 18)} (scaled)`);
    console.log(`  YES Supply: ${ethers.formatUnits(yesSupply, 18)}`);
    console.log(`  NO Supply: ${ethers.formatUnits(noSupply, 18)}`);
    try {
        const yesPrice = await factory.getMarketPrice(conditionId, yesId);
        const noPrice = await factory.getMarketPrice(conditionId, noId);
        console.log(`  YES Price: ${ethers.formatUnits(yesPrice, 18)} collateral/token`);
        console.log(`  NO Price: ${ethers.formatUnits(noPrice, 18)} collateral/token`);
    } catch (e) {
        // Price might fail if supply is zero for one side
        console.log("  Price calculation failed (likely zero supply for an outcome).");
    }
    if (settled) {
        const winningId = await factory.winningTokenId(conditionId);
        console.log(`  Settled: YES, Winning Token ID: ${winningId} (${winningId == yesId ? 'YES' : 'NO'})`);
    }
}

async function redeemAndLog(factory, collateralToken, user, conditionId, userName, collateralDecimals) {
    const winningTokenId = await factory.winningTokenId(conditionId);
    const initialBalance = await factory.balanceOf(user.address, winningTokenId);
    const initialCollateralUser = await collateralToken.balanceOf(user.address);
    console.log(`\n${userName} redeeming ${ethers.formatUnits(initialBalance, 18)} winning tokens...`);
    if (initialBalance == 0n) {
        console.log(`${userName} has no winning tokens to redeem.`);
        return { collateralReceivedWei: 0n, collateralReceivedFormatted: "0.0" }; 
    }
    let collateralChange = 0n;
    let redeemedAmount = 0n;
    try {
        const redeemTx = await factory.connect(user).redeemPosition(conditionId);
        const receipt = await redeemTx.wait();
        const redeemedEvent = receipt.logs.findLast(log => factory.interface.parseLog(log)?.name === "PNP_PositionRedeemed");
        redeemedAmount = redeemedEvent ? factory.interface.parseLog(redeemedEvent).args.amount : 0n;
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
    return { 
        collateralReceivedWei: redeemedAmount, 
        collateralReceivedFormatted: ethers.formatUnits(redeemedAmount, collateralDecimals)
    };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 
