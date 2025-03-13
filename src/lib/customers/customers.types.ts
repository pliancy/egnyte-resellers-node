import { Features } from '../types'

export interface EgnyteCustomer {
    customerEgnyteId: string
    planId: string
    powerUsers: UsageStat
    storageGB: UsageStat
    features: Features
}

export interface UsageStat {
    total: number
    used: number
    available: number
    free: number
}

export interface UpdateCustomer {
    powerUsers?: { total?: number }
    storageGB?: { total?: number }
}

export interface ResourceStats {
    total: number
    used: number
    available: number
    free: number
}
