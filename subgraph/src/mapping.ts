import { BigInt, Address } from "@graphprotocol/graph-ts"
import { ProjectCreated } from "../generated/MinestartersFactory/MinestartersFactory"
import { Deposited, FundsWithdrawn, FundraisingFinalized, Refunded } from "../generated/templates/BasketVault/BasketVault"
import { Transfer, BasketShareToken as BasketShareTokenContract } from "../generated/templates/BasketShareToken/BasketShareToken"
import { BasketVault as BasketVaultContract } from "../generated/templates/BasketVault/BasketVault"
import {
  Project, Holder,
  CompanyRegistered,
  CompanyStageAdvanced,
  CompanyUpdated,
  OwnershipTransferred,
  PriceUpdated,
  VaultRegistered
} from "../generated/schema"
import {
  CompanyRegistered as CompanyRegisteredEvent,
  CompanyStageAdvanced as CompanyStageAdvancedEvent,
  CompanyUpdated as CompanyUpdatedEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  PriceUpdated as PriceUpdatedEvent,
  VaultRegistered as VaultRegisteredEvent
} from "../generated/NAVEngine/NAVEngine"
import { BasketVault, BasketShareToken } from "../generated/templates"

const ZERO_BIGINT = BigInt.fromI32(0)
const ZERO_ADDRESS = Address.fromString("0x0000000000000000000000000000000000000000")

function hydrateProjectFromVault(project: Project, vaultAddress: Address): void {
  const vault = BasketVaultContract.bind(vaultAddress)
  const infoResult = vault.try_getProjectInfo()
  if (infoResult.reverted) {
    return
  }

  const info = infoResult.value
  project.name = info.projectName
  project.companyNames = info.companies
  project.companyWeights = info.weights
  project.token = info.shareTokenAddress
  project.creator = info.projectCreator
  project.withdrawAddress = info.projectWithdrawAddress
  project.minimumRaise = info.minRaise
  project.deadline = info.projectDeadline
  project.raiseFeeBps = info.raiseFee
  project.totalRaised = info.raised
  project.raiseFeesPaid = info.raiseFeesPaid
  project.isFinalized = info.isFinalized
  project.stage = info.stage
}

function refreshProjectState(project: Project, vaultAddress: Address): void {
  const vault = BasketVaultContract.bind(vaultAddress)
  const infoResult = vault.try_getProjectInfo()
  if (infoResult.reverted) {
    return
  }
  const info = infoResult.value
  project.stage = info.stage
  project.raiseFeesPaid = info.raiseFeesPaid
}

export function handleProjectCreated(event: ProjectCreated): void {
  let project = new Project(event.params.vault.toHexString())
  project.creator = event.params.creator
  project.vault = event.params.vault
  project.token = event.params.token
  project.withdrawAddress = ZERO_ADDRESS
  project.name = event.params.name
  project.companyNames = []
  project.companyWeights = []
  project.createdAt = event.block.timestamp
  project.transactionHash = event.transaction.hash
  project.minimumRaise = ZERO_BIGINT
  project.deadline = ZERO_BIGINT
  project.raiseFeeBps = ZERO_BIGINT
  project.raiseFeesPaid = ZERO_BIGINT
  project.stage = 0
  project.totalRaised = ZERO_BIGINT
  project.isFinalized = false
  project.isFundsWithdrawn = false
  hydrateProjectFromVault(project, event.params.vault)
  project.save()

  // Create templates
  BasketVault.create(event.params.vault)
  BasketShareToken.create(event.params.token)
}

export function handleDeposited(event: Deposited): void {
  let project = Project.load(event.address.toHexString())
  if (project) {
    project.totalRaised = project.totalRaised.plus(event.params.amount)
    refreshProjectState(project, event.address)
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
    refreshProjectState(project, event.address)
    project.save()
  }
}

export function handleFundraisingFinalized(event: FundraisingFinalized): void {
  let project = Project.load(event.address.toHexString())
  if (project) {
    project.isFinalized = true
    refreshProjectState(project, event.address)
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
      let vaultAddress = contract.try_VAULT()
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

// NAVEngine

export function handleCompanyRegistered(event: CompanyRegisteredEvent): void {
  let entity = new CompanyRegistered(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.vault = event.params.vault
  entity.companyIndex = event.params.companyIndex
  entity.name = event.params.name

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleCompanyStageAdvanced(
  event: CompanyStageAdvancedEvent
): void {
  let entity = new CompanyStageAdvanced(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.vault = event.params.vault
  entity.companyIndex = event.params.companyIndex
  entity.newStage = event.params.newStage
  entity.ipfsHashes = event.params.ipfsHashes

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleCompanyUpdated(event: CompanyUpdatedEvent): void {
  let entity = new CompanyUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.vault = event.params.vault
  entity.companyIndex = event.params.companyIndex

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleOwnershipTransferred(
  event: OwnershipTransferredEvent
): void {
  let entity = new OwnershipTransferred(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousOwner = event.params.previousOwner
  entity.newOwner = event.params.newOwner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handlePriceUpdated(event: PriceUpdatedEvent): void {
  let entity = new PriceUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.newPrice = event.params.newPrice

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleVaultRegistered(event: VaultRegisteredEvent): void {
  let entity = new VaultRegistered(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.vault = event.params.vault
  entity.tokenSupply = event.params.tokenSupply

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
