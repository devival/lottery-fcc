const { inputToConfig } = require("@ethereum-waffle/compiler")
const { assert, expect } = require("chai")
const { config } = require("dotenv")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")

// only run unit tests on a development chain
const { developmentChains, networkConfig } = require("../../helper-hardhat-config.js")

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
          // deploy Lottery,
          let lottery, entranceFee, deployer

          // run before each test in a describe
          beforeEach(async function () {
              // get deployer account
              deployer = (await getNamedAccounts()).deployer
              // store contract in the variable
              lottery = await ethers.getContract("Lottery", deployer)
              entranceFee = await lottery.getEntranceFee()
          })
          describe("fulfillRandomWords", function () {
              it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
                  // enter the lottery
                  const startingTimeStamp = await lottery.getLastTimeStamp()
                  const accounts = await ethers.getSigners()

                  await new Promise(async (resolve, reject) => {
                      // setup listener before we enter the lottery
                      // just in case the blockchain moves REALLY fast
                      lottery.once("WinnerPicked", async () => {
                          console.log("WinnerPicked even fired!")
                          try {
                              // asserts here
                              const recentWinner = await lottery.getRecentWinner()
                              const lotteryState = await lottery.getLotteryState()
                              const endingTimeStamp = await lottery.getLastTimeStamp()
                              const winnerEndingBalance = await accounts[0].getBalance()

                              await expect(lottery.getPlayers(0)).to.be.reverted

                              assert.equal(recentWinner.toString(), accounts[0].address)
                              assert.equal(lotteryState, 0)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(entranceFee).toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve()
                          } catch (e) {
                              reject(e)
                          }
                      })
                      // then enter the lottery
                      console.log("Entering Lottery...")
                      const tx = await lottery.enterLottery({ value: entranceFee })
                      await tx.wait(1)
                      console.log("Please wait...")
                      const winnerStartingBalance = await accounts[0].getBalance()
                  })

                  // the code WILL NOT complete until the listener finished listening
              })
          })
      })
