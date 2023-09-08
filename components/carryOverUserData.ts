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

import { GameVersion, UserProfile } from "./types/types"
import { userAuths } from "./officialServerAuth"
import { log, LogLevel } from "./loggingInterop"
import { missionsInLocations } from "./contracts/missionsInLocation"
import { AxiosResponse } from "axios"
import { getVersionedConfig } from "./configSwizzleManager"

export async function carryOverUserData(pId: string, gameVersion: GameVersion) {
    const user = userAuths.get(pId)

    if (!user) {
        return undefined
    }

    const officialResponses: {
        GetProfile: object
        PlayerProfile: object
        Challenges: Map<string, object>
    } = { GetProfile: {}, PlayerProfile: {}, Challenges: new Map() }

    // GetProfile request to official server
    const responseGetProfile = await user._useService(
        "https://hm3-service.hitman.io/authentication/api/userchannel" +
            "/ProfileService/GetProfile",
        false,
        {
            id: "22ebbd4b-062f-4321-81b8-03f74ab161bc",
            extensions: [
                // TODO: Remove extensions that are not needed.
                "achievements",
                "cliententitlements",
                "contractsession",
                "defaultloadout",
                "friends",
                "gameclient",
                "gamepersistentdata",
                "inventory",
                "migration",
                "opportunityprogression",
                "progression",
                "UserConfigSettings",
            ],
        },
    )

    if (responseGetProfile.status !== 200) {
        log(LogLevel.ERROR, "Error getting user profile from official server.")
        return undefined
    } else {
        officialResponses.GetProfile = responseGetProfile.data
    }

    // PlayerProfile request to official server
    const responsePlayerProfile = await user._useService(
        "https://hm3-service.hitman.io/profiles/page/PlayerProfile",
        true,
    )

    if (responsePlayerProfile.status !== 200) {
        log(
            LogLevel.ERROR,
            "Error getting player profile from official server.",
        )
        return undefined
    } else {
        officialResponses.PlayerProfile = responsePlayerProfile.data.data
    }

    /*
     This is probably not the most efficient way to do this, but I haven't
     found an endpoint that returns all challenges,
     so we have to make a request for each location.
     It only takes a few seconds, so it's not a big deal.
    */

    const locations = collectStrings(missionsInLocations)
    const promises: Promise<
        AxiosResponse<{ Challenge: object; Progression: object }[]>
    >[] = []

    for (const locationsKey in locations) {
        const responseMapChallenges = user._useService(
            "https://hm3-service.hitman.io/authentication/api/userchannel" +
                "/ChallengesService/GetActiveChallengesAndProgression",
            false,
            {
                contractId: locations[locationsKey],
                difficultyLevel: 2,
            },
        )

        log(
            LogLevel.DEBUG,
            `Getting map challenges for ${locations[locationsKey]}` +
                ` (${parseInt(locationsKey) + 1}/${locations.length})`,
        )

        promises.push(responseMapChallenges)
    }

    await Promise.all(promises).then((responses) => {
        for (const response of responses) {
            if (response.status !== 200) {
                log(
                    LogLevel.ERROR,
                    "Error getting map challenges from official server." +
                        ` (${response.data["contractId"]})`,
                )
                return undefined
            } else {
                for (const challenge of response.data) {
                    officialResponses.Challenges.set(
                        challenge.Challenge["Id"],
                        challenge,
                    )
                }
            }
        }

        return undefined
    })

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
        userData[key] = officialResponses.GetProfile[key]
    }

    userData.Extensions["gameclient"] =
        officialResponses.GetProfile["Extensions"].gameclient
    const progression = userData.Extensions.progression
    const officialProgression =
        officialResponses.GetProfile["Extensions"].progression

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

    for (const sublocation of officialResponses.PlayerProfile[
        "SubLocationData"
    ]) {
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

    const officialProfileXp = officialResponses.PlayerProfile["PlayerProfileXp"]
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
        officialResponses.GetProfile["Extensions"].gamepersistentdata

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
        officialResponses.GetProfile["Extensions"].opportunityprogression
    userData.Extensions.opportunityprogression = Object.keys(
        officialOpportunityProgression,
    ).reduce((result: object, key) => {
        result[key] = officialOpportunityProgression[key] !== ""
        return result
    }, {}) // Convert to boolean

    userData.Extensions["friends"] =
        officialResponses.GetProfile["Extensions"].friends

    // TODO: CPD

    userData.Extensions.achievements =
        officialResponses.GetProfile["Extensions"].achievements

    userData.Extensions.ChallengeProgression = {}

    for (const challenge of officialResponses.Challenges.values()) {
        const challengeProgression = challenge["Progression"]
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

        if (
            challengeProgression.ChallengeId ===
            "7107ff08-2d82-4abd-83e5-57d0e1b919ff"
        ) {
            console.log(challengeProgression)
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
