/*
 *     The Peacock Project - a HITMAN server replacement.
 *     Copyright (C) 2021-2023 The Peacock Project Team
 *
 *     This program is free software: you can redistribute it and/or modify
 *     it under the terms of the GNU Affero General Public License as published by
 *     the Free Software Foundation, either version 3 of the License, or
 *     (at your option) any later version.
 *
 *     This program is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *     GNU Affero General Public License for more details.
 *
 *     You should have received a copy of the GNU Affero General Public License
 *     along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {
    CompiledChallengeRuntimeData,
    CPDStore,
    GameVersion,
    MissionManifest,
    RegistryChallenge,
    UserProfile,
} from "./types/types"
import { OfficialServerAuth, userAuths } from "./officialServerAuth"
import { log, LogLevel } from "./loggingInterop"
import { missionsInLocations } from "./contracts/missionsInLocation"
import { getVersionedConfig } from "./configSwizzleManager"
import { controller } from "./controller"
import { handleEvent } from "@peacockproject/statemachine-parser"
import { StateMachineLike } from "@peacockproject/statemachine-parser/src/types"
import { getFlag } from "./flags"
import { getRemoteService } from "./utils"

interface GetProfileBody {
    DevId: null | string
    SteamId: null | string
    StadiaId: null | string
    EpicId: null | string
    NintendoId: null | string
    XboxLiveId: null | string
    PSNAccountId: null | string
    PSNOnlineId: null | string
    Id: string
    LinkedAccounts: {
        dev?: string
        epic?: string
        steam?: string
        gog?: string
        xbox?: string
        stadia?: string
    }
    ETag: null | string
    Gamertag: string
    Extensions: {
        achievements: `${number}`[]
        friends: string[]
        gameclient: null | unknown
        gamepersistentdata: {
            __stats?: unknown
            prologue: {
                "proceed-intro": boolean
            }
            menudata: {
                destinations: unknown
                planning: unknown
                newunlockables: string[]
            }
            PersistentBool: Record<string, unknown>
            IsFSPUser: boolean
            VideoShown: Record<string, boolean>
            HitsFilterType: {
                // "all" / "completed" / "failed"
                MyHistory: string
                MyContracts: string
                MyPlaylist: string
            }
            EpilogueSeen: Record<string, boolean>
        }
        opportunityprogression: Record<string, string>
        progression: {
            XPGain: number
            secondsToNextDrop: number
            secondsElapsed: number
            LastCompletedChallenge: string
            Locations: Record<
                string,
                {
                    Xp: number
                    PreviouslySeenXp: number
                    LastCompletedChallenge: string
                    PreviouslySeenStaging: object
                    Level: number
                }
            >
            PlayerProfileXP: {
                Total: number
                PreviouslySeenTotal: number
                ProfileLevel: number
                PreviouslySeenStaging: object
                Sublocations: {
                    Location: string
                    Xp: number
                    ActionXp: number
                }[]
            }
            LastScore: number
            TimeDropDelta: number
            Unlockables: Record<
                string,
                {
                    Xp: number
                    PreviouslySeenXp: number
                    LastCompletedChallenge: string
                    PreviouslySeenStaging: object
                    Level: number
                }
            >
        }
    }
}
interface GetPlayerProfileBody {
    template: unknown
    data: {
        SubLocationData: {
            ParentLocation: object
            Location: object
            CompletionData: {
                Level: number
                MaxLevel: number
                XP: number
                Completion: number
                XpLeft: number
                Id: string
                SubLocationId: string
                HideProgression: boolean
                IsLocationProgression: boolean
                Name: null | unknown
            }
            ChallengeCategoryCompletion: {
                Name: string
                CompletedChallengesCount: number
                ChallengesCount: number
            }[]
            ChallengeCompletion: {
                ChallengesCount: number
                CompletedChallengesCount: number
                CompletionPercent: number
            }
            OpportunityStatistics: {
                Count: number
                Completed: number
            }
            LocationCompletionPercent: number
        }[]
        PlayerProfileXp: {
            Total: number
            Level: number
            Seasons: {
                Number: number
                Locations: {
                    LocationId: string
                    Xp: number
                    ActionXp: number
                    LocationProgression: {
                        Level: number
                        MaxLevel: number
                    }
                }[]
            }[]
        }
    }
}
interface HitsCategoryBody {
    data: {
        Category: string
        Data: {
            Type: string
            Hits: {
                Id: string
                UserCentricContract: {
                    Data: {
                        EscalationCompletedLevels: number
                        EscalationTotalLevels: number
                        EscalationCompleted: boolean
                        LastPlayedAt: string
                        Completed: boolean
                    }
                    Contract: MissionManifest
                }
            }[]
            Page: number
            HasMore: boolean
        }
    }
}

async function requestGetProfile(user: OfficialServerAuth, remoteService) {
    const response = await user._useService<GetProfileBody>(
        `https://${remoteService}.hitman.io/authentication/api/userchannel` +
            "/ProfileService/GetProfile",
        false,
        {
            id: "22ebbd4b-062f-4321-81b8-03f74ab161bc",
            extensions: [
                "achievements",
                "friends",
                "gameclient",
                "gamepersistentdata",
                "opportunityprogression",
                "progression",
            ],
        },
    )

    if (response.status !== 200) {
        throw new Error("Error getting user profile from official server.")
    } else {
        return response.data
    }
}

async function requestPlayerProfile(user: OfficialServerAuth, remoteService) {
    const response = await user._useService<GetPlayerProfileBody>(
        `https://${remoteService}.hitman.io/profiles/page/PlayerProfile`,
        true,
    )

    if (response.status !== 200) {
        throw new Error("Error getting user profile from official server.")
    } else {
        return response.data.data
    }
}

function requestMapChallenges(
    user: OfficialServerAuth,
    location: string,
    remoteService,
) {
    return user._useService<CompiledChallengeRuntimeData>(
        `https://${remoteService}.hitman.io/authentication/api/userchannel` +
            "/ChallengesService/GetActiveChallengesAndProgression",
        false,
        {
            contractId: location,
            difficultyLevel: 2,
        },
    )
}

async function requestChallenges(user: OfficialServerAuth, remoteService) {
    /*
     This is probably not the most efficient way to do this, but I haven't
     found an endpoint that returns all challenges,
     so we have to make a request for each location.
     It only takes a few seconds, so it's not a big deal.
    */

    const locations = collectStrings(missionsInLocations)
    const promises = []

    for (const locationsKey in locations) {
        const responseMapChallenges = requestMapChallenges(
            user,
            locations[locationsKey],
            remoteService,
        )

        log(
            LogLevel.DEBUG,
            `Getting map challenges for ${locations[locationsKey]}` +
                ` (${parseInt(locationsKey) + 1}/${locations.length})`,
        )

        promises.push(responseMapChallenges)
    }

    const responses = await Promise.all(promises).catch((e) => {
        throw new Error(
            `Error getting escalation contracts from official server: ${e}`,
        )
    })
    const challenges = new Map()

    for (const response of responses) {
        if (response.status !== 200) {
            throw new Error(
                "Error getting map challenges from official server." +
                    ` (${response.request.body.contractId})`,
            )
        } else {
            for (const challenge of response.data) {
                challenges.set(challenge.Challenge.Id, challenge)
            }
        }
    }

    return challenges
}

async function requestHitsCategory(
    user: OfficialServerAuth,
    type: string,
    page: number,
    remoteService,
) {
    return (
        await user._useService<HitsCategoryBody>(
            `https://${remoteService}.hitman.io/profiles/page/HitsCategory` +
                `?page=${page}&type=${type}&mode=dataonly`,
            true,
        )
    ).data.data
}

async function requestHitsCategoryAll(
    user: OfficialServerAuth,
    type: string,
    remoteService,
) {
    const hits: HitsCategoryBody["data"]["Data"]["Hits"] = []
    let page = 0
    let hasMore = true

    while (hasMore) {
        const response = await requestHitsCategory(
            user,
            type,
            page,
            remoteService,
        )
        hits.push(...response.Data.Hits)
        hasMore = response.Data.HasMore
        page++
    }

    return hits
}

async function requestGetForPlay2(
    user: OfficialServerAuth,
    missionId: string,
    remoteService,
) {
    log(
        LogLevel.DEBUG,
        "Getting CPD from official server.",
    )
    const response = await user._useService<
        {
            ContractSessionId: string
            ContractProgressionData: CPDStore
        }
    >(
        `https://${remoteService}.hitman.io/authentication/api/userchannel/ContractsService/GetForPlay2`,
        false,
        {
            id: missionId,
            locationId: "",
            extraGameChangerIds: [],
            difficultyLevel: 0,
        },
    ).catch((e) => {return e.response})

    if (response.status !== 200) {
        throw new Error(
            "Error getting freelancer CPD from official server." +
                ` (${response.status})`,
        )
    } else {
        return response.data
    }
}

async function getOfficialResponses(pId: string, gameVersion: GameVersion) {
    const user = userAuths.get(pId)

    if (!user) {
        throw new Error("User not found.")
    }

    const remoteService = getRemoteService(gameVersion)
    const freelancerId = "f8ec92c2-4fa2-471e-ae08-545480c746ee"

    return {
        GetProfile: await requestGetProfile(user, remoteService),
        PlayerProfile: await requestPlayerProfile(user, remoteService),
        Challenges: await requestChallenges(user, remoteService),
        ContractAttack: await requestHitsCategoryAll(
            user,
            "ContractAttack",
            remoteService,
        ),
        Arcade: await requestHitsCategoryAll(user, "Arcade", remoteService),
        MyHistory: await requestHitsCategoryAll(
            user,
            "MyHistory",
            remoteService,
        ),
        MyContracts: await requestHitsCategoryAll(
            user,
            "MyContracts",
            remoteService,
        ),
        MyPlaylist: await requestHitsCategoryAll(
            user,
            "MyPlaylist",
            remoteService,
        ),
        CPD: {
            [freelancerId]: await requestGetForPlay2(
                user,
                freelancerId,
                remoteService
            ).catch((e) => {
                log(
                    LogLevel.ERROR,
                    `Error getting freelancer CPD from official server: ${e.message}`,
                ) // This happens way too often.
                return undefined
            }),
        }
    }
}

export async function carryOverUserData(pId: string, gameVersion: GameVersion) {
    const oResp = await getOfficialResponses(pId, gameVersion)

    const userData = getVersionedConfig(
        "UserDefault",
        gameVersion,
        true,
    ) as UserProfile

    for (const key of [
        "Id",
        "LinkedAccounts",
        "ETag",
        "Gamertag",
        "DevId",
        "SteamId",
        "StadiaId",
        "EpicId",
        "NintendoId",
        "XboxLiveId",
        "PSNAccountId",
        "PSNOnlineId",
    ]) {
        userData[key] = oResp.GetProfile[key]
    }

    userData.Extensions["gameclient"] = oResp.GetProfile.Extensions.gameclient

    const progression = userData.Extensions.progression
    const officialProgression = oResp.GetProfile.Extensions.progression

    for (const key of [
        "XPGain",
        "secondsToNextDrop",
        "secondsElapsed",
        "LastScore",
        "LastCompletedChallenge",
        "TimeDropDelta",
    ]) {
        progression[key] = officialProgression[key]
    }

    for (const sublocation of oResp.PlayerProfile.SubLocationData) {
        const location = progression.Locations[sublocation.CompletionData.Id]

        // TODO: Make this work for scpc
        if (Object.hasOwn(location, "Xp")) {
            location.Xp = sublocation.CompletionData.XP
            location.Level = sublocation.CompletionData.Level
            location.PreviouslySeenXp = sublocation.CompletionData.XP
        } else {
            // its type is {[p: string]: ProgressionData}
            for (const sublocationKey in location) {
                const sublocationValue = location[sublocationKey]
                sublocationValue.Xp = sublocation.CompletionData.XP
                sublocationValue.Level = sublocation.CompletionData.Level
                sublocationValue.PreviouslySeenXp =
                    sublocation.CompletionData.XP
            }
        }
    }

    const officialProfileXp = oResp.PlayerProfile.PlayerProfileXp
    progression.PlayerProfileXP.Total = officialProfileXp.Total
    progression.PlayerProfileXP["PreviouslySeenTotal"] =
        officialProgression.PlayerProfileXP.PreviouslySeenTotal
    progression.PlayerProfileXP.ProfileLevel = officialProfileXp.Level
    progression.PlayerProfileXP["PreviouslySeenStaging"] =
        officialProgression.PlayerProfileXP.PreviouslySeenStaging

    progression.PlayerProfileXP.Sublocations = []

    for (const season of officialProfileXp.Seasons) {
        for (const location of season.Locations) {
            progression.PlayerProfileXP.Sublocations.push({
                Location: location.LocationId,
                Xp: location.Xp,
                ActionXp: location.ActionXp,
            })
        }
    }

    const gamepersistentdata = userData.Extensions.gamepersistentdata
    const officialGamePersistentData =
        oResp.GetProfile.Extensions.gamepersistentdata

    gamepersistentdata["IsFSPUser"] = officialGamePersistentData.IsFSPUser
    gamepersistentdata["prologue"] = officialGamePersistentData.prologue

    gamepersistentdata.menudata.newunlockables =
        officialGamePersistentData.menudata.newunlockables
    gamepersistentdata.menudata["persistentdatacomponent"] = {
        destinations: officialGamePersistentData.menudata.destinations,
        planning: officialGamePersistentData.menudata.planning,
    }
    gamepersistentdata.menudata["destinations"] =
        officialGamePersistentData.menudata.destinations

    gamepersistentdata.PersistentBool =
        officialGamePersistentData.PersistentBool
    gamepersistentdata["VideoShown"] = officialGamePersistentData.VideoShown
    gamepersistentdata["EpilogueSeen"] = officialGamePersistentData.EpilogueSeen
    gamepersistentdata["__stats"] = officialGamePersistentData.__stats

    const officialOpportunityProgression =
        oResp.GetProfile.Extensions.opportunityprogression
    userData.Extensions.opportunityprogression = Object.keys(
        officialOpportunityProgression,
    ).reduce((result: object, key) => {
        result[key] = officialOpportunityProgression[key] !== ""
        return result
    }, {}) // Convert to boolean

    userData.Extensions["friends"] = oResp.GetProfile.Extensions.friends

    // TODO: CPD

    userData.Extensions.achievements = oResp.GetProfile.Extensions.achievements

    userData.Extensions.ChallengeProgression = {}

    for (const challenge of oResp.Challenges.values()) {
        const challengeProgression = challenge.Progression
        userData.Extensions.ChallengeProgression[
            challengeProgression.ChallengeId
        ] = {
            // Sometimes the server says a challenge is not completed, but it is.
            Ticked:
                challengeProgression.Completed ||
                challengeProgression.CompletedAt !== null,
            Completed:
                challengeProgression.Completed ||
                challengeProgression.CompletedAt !== null,
            CurrentState: challengeProgression.State.CurrentState ?? "Start",
            State: challengeProgression.State,
        }
    }

    // Fix for peacock-exclusive challenge 2546d4f7-191c-4858-840f-321d31aed410
    userData.Extensions.ChallengeProgression[
        "2546d4f7-191c-4858-840f-321d31aed410"
    ] = getChallengeAfterAreasDiscovered(
        "2546d4f7-191c-4858-840f-321d31aed410",
        gameVersion,
        [
            "fa7b2877-3159-454a-82d3-422a0dd7e5da",
            "7cfd6202-b3fb-4c9f-b3c2-c892b8031901",
            "0a4513e4-338c-4328-ad72-82c1b5ff2a73",
            "705c3917-9f3d-4444-a268-41e74bc8e4ad",
            "ba0fe890-9feb-4991-82f8-5daf7aff3380",
        ].filter(
            (area) =>
                oResp.GetProfile.Extensions.gamepersistentdata.PersistentBool[
                    area
                ] === true,
        ),
    )

    // Escalations and Arcades
    for (const hit of oResp.ContractAttack.concat(oResp.Arcade)) {
        const Id = hit.Id
        userData.Extensions.PeacockEscalations[Id] =
            hit.UserCentricContract.Data.EscalationCompletedLevels + 1

        if (hit.UserCentricContract.Data.EscalationCompleted) {
            userData.Extensions.PeacockCompletedEscalations.push(Id)
        }
    }

    const limit = getFlag("downloadContractHistoryLimit") as number

    const toDownload = {
        MyHistory: getFlag("downloadContractHistory") ? oResp.MyHistory : [],
        MyContracts: getFlag("downloadMyContracts") ? oResp.MyContracts : [],
        MyPlaylist: getFlag("downloadFavorites") ? oResp.MyPlaylist : [],
    }

    if (limit !== 0) {
        toDownload.MyContracts = toDownload.MyContracts.slice(0, limit)
    }

    for (const hit of [
        ...toDownload.MyContracts,
        ...toDownload.MyPlaylist,
        ...toDownload.MyHistory,
    ]) {
        if (controller.resolveContract(hit.Id)) {
            continue
        }

        const publicId = hit.UserCentricContract.Contract.Metadata.PublicId

        if (!/^[1-3]\d{2}\d{7}\d{2}$/.test(publicId)) {
            log(
                LogLevel.INFO,
                `Skipping contract ${publicId} because it is not supported.`,
            )
            continue
        }

        await controller
            .downloadContract(pId, publicId, gameVersion)
            .catch((e) => {
                log(
                    LogLevel.ERROR,
                    `Error downloading contract ${publicId}: ${e.message}`,
                )
            })
    }

    if (getFlag("downloadContractHistory")) {
        for (const hit of oResp.MyHistory) {
            userData.Extensions.PeacockPlayedContracts[hit.Id] = {
                LastPlayedAt: new Date(
                    hit.UserCentricContract.Data.LastPlayedAt,
                ).getTime(),
                Completed: hit.UserCentricContract.Data.Completed,
                IsEscalation: false,
            }
        }
    }

    for (const hit of [...toDownload.MyContracts, ...toDownload.MyPlaylist]) {
        userData.Extensions.PeacockFavoriteContracts.push(hit.Id)
    }

    // Freelancer CPD
    for (const cpdId in oResp.CPD) {
        if (!oResp.CPD[cpdId]) { continue }

        userData.Extensions.CPD[cpdId] = oResp.CPD[cpdId]

        for (const key in oResp.CPD[cpdId].ContractProgressionData) {
            userData.Extensions.CPD[cpdId][key] =
                oResp.CPD[cpdId].ContractProgressionData[key]
        }
    }

    return userData
}

function getChallengeAfterAreasDiscovered(
    challengeId: string,
    gameVersion: GameVersion,
    areasDiscovered: string[],
) {
    // Get the challenge definition:
    const challenge: RegistryChallenge =
        controller.challengeService.getChallengeById(challengeId, gameVersion)
    const definition = challenge.Definition
    let state = "Start"
    let context = definition.Context

    for (const area of areasDiscovered) {
        const result = handleEvent(
            definition as StateMachineLike<
                Partial<Record<string, unknown | string[] | string>>
            >,
            context,
            {
                RepositoryId: area,
            },
            {
                timestamp: null,
                eventName: "AreaDiscovered",
                currentState: state,
                timers: [],
            },
        )
        state = result.state
        context = result.context
    }

    return {
        Ticked: false,
        Completed: state === "Success",
        CurrentState: state,
        State: context,
    }
}

// Helper function to loop over all missions
function collectStrings(obj: object): string[] {
    const strings: string[] = []

    function recursiveCollect(obj: object) {
        if (Array.isArray(obj)) {
            strings.push(...obj.filter((item) => typeof item === "string"))
        } else if (typeof obj === "object") {
            for (const key in obj) {
                recursiveCollect(obj[key])
            }
        }
    }

    recursiveCollect(obj)
    return strings
}
