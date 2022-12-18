const { inputToConfig } = require("@ethereum-waffle/compiler")
const { assert, expect } = require("chai")
const { config } = require("dotenv")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")

// only run unit tests on a development chain
const { developmentChains, networkConfig } = require("../../helper-hardhat-config.js")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
          // deploy Lottery, vrf Mock
          let lottery, vrfCoordinatorV2Mock, entranceFee, deployer, interval
          const chainId = network.config.chainId

          // run before each test in a describe
          beforeEach(async function () {
              // get deployer account
              deployer = (await getNamedAccounts()).deployer
              // deploy everything before each test
              await deployments.fixture(["all"])
              // store contract in the variable
              lottery = await ethers.getContract("Lottery", deployer)
              // store Mock in the variable
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              entranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          // testing constructor
          describe("constructor", function () {
              it("initialises the lottery correctly", async function () {
                  // check if lotteryState is OPEN("0") and not CALCULATING("1")
                  const lotteryState = await lottery.getLotteryState()
                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["keepersUpdateInterval"])
              })
          })
          // revert if not paid enough
          // testing enterLottery function
          describe("enterLottery", function () {
              it("reverts if not paid enough", async function () {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughETHEntered"
                  )
              })
              it("records players when they enter", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  const player = await lottery.getPlayers(0)
                  assert.equal(player, deployer)

                  /* Through getNumberOfPlayers function
                  const playersBefore = (await lottery.getNumberOfPlayers()).toString()
                  await lottery.enterLottery({ value: entranceFee })
                  const playersAfter = (await lottery.getNumberOfPlayers()).toString()
                  assert.equal(playersBefore, playersAfter - 1)
                  */
              })
              it("emits an event on enter", async function () {
                  await expect(lottery.enterLottery({ value: entranceFee }))
                      .to.emit(lottery, "LotteryEnter")
                      .withArgs(deployer)
              })
              it("reverts when lotteryState is closed (when CALCULATING)", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  // Pretend to be a Chainlink Keeper
                  await lottery.performUpkeep([])
                  await expect(lottery.enterLottery({ value: entranceFee })).to.be.revertedWith(
                      "Lottery__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  // Appending callStatic while calling a function in tests
                  // will not create a transaction but it simulates the transaction
                  // and give the results
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns false if lottery isn't open", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  // Pretend to be a Chainlink Keeper
                  await lottery.performUpkeep([])
                  const lotteryState = await lottery.getLotteryState()
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert.equal(lotteryState.toString(), "1")
                  assert(!upkeepNeeded)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                  await network.provider.request({ method: "evm_mine", params: [] })

                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })

                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })
          describe("performUpkeep", function () {
              it("can only run while checkUpkeep is true", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  const tx = await lottery.performUpkeep([])
                  assert(tx)
              })
              it("reverts if checkUpkeep is false", async function () {
                  //   const tx = await lottery.performUpkeep([])
                  //   expect(tx).to.be.revertedWith("Lottery__UpkeepNotNeeded")
                  // the above version fails. using the one below
                  await expect(lottery.performUpkeep([])).to.be.revertedWith(
                      "Lottery__UpkeepNotNeeded"
                  )
              })
              it("updates lotteryState, emits an event, call the vrfCoordinator", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  const txResponse = await lottery.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const lotteryState = await lottery.getLotteryState()

                  assert(requestId.toNumber() > 0)
                  assert(lotteryState.toString(), "1")
              })
          })
          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  // before each test, somebody has to enter the lottery and increase time and mine + 1 block
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
              })
              // the biggest test
              it("picks a winner, resets the lottery, sends money", async function () {
                  // first, connect 3 test accounts to the contract and enter the lottery
                  const additionalEntrants = 3
                  const stratingAccountIndex = 1 // deployer = 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = stratingAccountIndex;
                      i < stratingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedLottery = lottery.connect(accounts[i])
                      await accountConnectedLottery.enterLottery({ value: entranceFee })
                  }
                  const startingTimeStamp = await lottery.getLastTimeStamp()

                  // performUpkeep (mock being Chainlink Keepers)
                  // fulfillRandomWords (mock being Chainlink VRF)
                  // we will have to wait for the fulfillRandonWords to be called
                  await new Promise(async (resolve, reject) => {
                      lottery.once("WinnerPicked", async () => {
                          try {
                              const recentWinner = await lottery.getRecentWinner()
                              const lotteryState = await lottery.getLotteryState()
                              const endingTimeStamp = await lottery.getLastTimeStamp()
                              const numPlayers = await lottery.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()

                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(lotteryState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      entranceFee
                                          .mul(additionalEntrants)
                                          .add(entranceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      // setting up the listener
                      // below, we will fire the event, and the listener wil pick it up, and resolve
                      const tx = await lottery.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })
          })
      })
