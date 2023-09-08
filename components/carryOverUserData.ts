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

import { CompiledChallengeRuntimeData, GameVersion, UserProfile } from "./types/types"
import { OfficialServerAuth, userAuths } from "./officialServerAuth"
import { log, LogLevel } from "./loggingInterop"
import { missionsInLocations } from "./contracts/missionsInLocation"
import { getVersionedConfig } from "./configSwizzleManager"

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
        gameclient: null | unknown // TODO: get steam response
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

async function requestGetProfile(user: OfficialServerAuth) {
    const response = await user._useService<GetProfileBody>(
        "https://hm3-service.hitman.io/authentication/api/userchannel" +
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

async function requestPlayerProfile(user: OfficialServerAuth) {
    const response = await user._useService<GetPlayerProfileBody>(
        "https://hm3-service.hitman.io/profiles/page/PlayerProfile",
        true,
    )

    if (response.status !== 200) {
        throw new Error("Error getting user profile from official server.")
    } else {
        return response.data.data
    }
}

function requestMapChallenges(user: OfficialServerAuth, location: string) {
    return user._useService<CompiledChallengeRuntimeData>(
        "https://hm3-service.hitman.io/authentication/api/userchannel" +
            "/ChallengesService/GetActiveChallengesAndProgression",
        false,
        {
            contractId: location,
            difficultyLevel: 2,
        },
    )
}

async function requestChallenges(user: OfficialServerAuth) {
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
        )

        log(
            LogLevel.DEBUG,
            `Getting map challenges for ${locations[locationsKey]}` +
                ` (${parseInt(locationsKey) + 1}/${locations.length})`,
        )

        promises.push(responseMapChallenges)
    }

    const responses = await Promise.all(promises)
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

async function getOfficialResponses(pId: string) {
    const user = userAuths.get(pId)

    if (!user) {
        throw new Error("User not found.")
    }

    return {
        GetProfile: await requestGetProfile(user),
        PlayerProfile: await requestPlayerProfile(user),
        Challenges: await requestChallenges(user),
    }
}

export async function carryOverUserData(pId: string, gameVersion: GameVersion) {
    const oResp = await getOfficialResponses(pId)

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
            Ticked: true,
            // Sometimes the server says a challenge is not completed, but it is.
            Completed:
                challengeProgression.Completed ||
                challengeProgression.CompletedAt !== null,
            CurrentState: challengeProgression.State.CurrentState ?? "Start",
            State: challengeProgression.State,
        }
    }

    return userData
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
