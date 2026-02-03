import { BigInt, Address } from "@graphprotocol/graph-ts"
import { ProjectCreated } from "../generated/MinestartersFactory/MinestartersFactory"
import { Deposited, FundsWithdrawn, FundraisingFinalized, Refunded } from "../generated/templates/BasketVault/BasketVault"
import { Transfer, BasketShareToken as BasketShareTokenContract } from "../generated/templates/BasketShareToken/BasketShareToken"
import { Project, Holder } from "../generated/schema"
import { BasketVault, BasketShareToken } from "../generated/templates"

export function handleProjectCreated(event: ProjectCreated): void {
  let project = new Project(event.params.vault.toHexString())
  project.creator = event.params.creator
  project.vault = event.params.vault
  project.token = event.params.token
  project.name = event.params.name
  project.createdAt = event.block.timestamp
  project.transactionHash = event.transaction.hash
  project.totalRaised = BigInt.fromI32(0)
  project.isFinalized = false
  project.isFundsWithdrawn = false
  project.save()

  // Create templates
  BasketVault.create(event.params.vault)
  BasketShareToken.create(event.params.token)
}

export function handleDeposited(event: Deposited): void {
  let project = Project.load(event.address.toHexString())
  if (project) {
    project.totalRaised = project.totalRaised.plus(event.params.amount)
    project.save()

    // Update Holder's initialDepositChain
    let holderId = project.token.toHexString() + "-" + event.params.user.toHexString()
    let holder = Holder.load(holderId)
    if (holder) {
      if (holder.initialDepositChain.equals(BigInt.fromI32(0))) {
        holder.initialDepositChain = event.params.sourceChainId
        holder.save()
      }
    }
  }
}

export function handleFundsWithdrawn(event: FundsWithdrawn): void {
  let project = Project.load(event.address.toHexString())
  if (project) {
    project.isFundsWithdrawn = true
    project.save()
  }
}

export function handleFundraisingFinalized(event: FundraisingFinalized): void {
  let project = Project.load(event.address.toHexString())
  if (project) {
    project.isFinalized = true
    project.save()
  }
}

export function handleRefunded(event: Refunded): void {
  // Balance update handled by Transfer (Burn)
}

export function handleTransfer(event: Transfer): void {
  let tokenAddress = event.address
  let from = event.params.from
  let to = event.params.to
  let value = event.params.value

  let fromId = tokenAddress.toHexString() + "-" + from.toHexString()
  let toId = tokenAddress.toHexString() + "-" + to.toHexString()

  if (from != Address.fromString("0x0000000000000000000000000000000000000000")) {
    let holder = Holder.load(fromId)
    if (holder) {
      holder.balance = holder.balance.minus(value)
      holder.save()
    }
  }

  if (to != Address.fromString("0x0000000000000000000000000000000000000000")) {
    let holder = Holder.load(toId)
    if (!holder) {
      holder = new Holder(toId)
      holder.user = to
      holder.balance = BigInt.fromI32(0)
      holder.initialDepositChain = BigInt.fromI32(0)

      let contract = BasketShareTokenContract.bind(event.address)
      let vaultAddress = contract.try_vault()
      if (!vaultAddress.reverted) {
        holder.project = vaultAddress.value.toHexString()
      } else {
        holder.project = "0x00"
      }
    }
    holder.balance = holder.balance.plus(value)
    holder.save()
  }
}
