[Official Peacock Project GitHub repository](https://github.com/thepeacockproject/Peacock)

# Flow-Peacock

I made this project to carry over Hitman 3 progression from the official servers to Peacock.

This is NOT a part of the Peacock project. Please do not bother the Peacock devs with issues related to this project.

## ❔ Usage

The project is mainly intended to be a one-time use as I did not care about properly implementing update functionality.

Steps:

1. If you have played with peacock already, back up your save file. I might make a save file merger, but even if I don't, it's always good to avoid deleting your stuff.
2. Set up this version just like you would the official version. Don't forget to copy the options you changed, and configure the new options according to your preferences.
3. Upon first launch, the game should automatically detect that you don't have a savefile yet, and will attempt to make requests to the official servers and compile a save file for you. If something goes wrong, delete the `userdata` folder and try again. If it still doesn't work, dm me on discord ([@vitphire](https://discord.com/users/483930002405195776)).
4. If everything went well, you should be able to play the game with your official progression.
5. You can (and should) go back to the official Peacock branch by backing up the `userdata` folder and pasting it back after setting up the official version.

## ⚠ Warnings

-   Scraping the save data from the official servers is not officially supported by IOI, and therefore the code has to make a lot of requests. I'll try to make it less in the future.
-   The sniper gamemode's progression is not carried over yet. I'll try to add it in the future.

## 🛠 Config options

-   `downloadContractHistory`: When set to true, this will download all contracts in your history (you can find it by going to Game modes > Contracts > History). This is useful if you want to play contracts that you played on the official servers, but it will take a while to download all of them.
    _(Default: false)_
-   `downloadContractHistoryLimit`: The maximum number of contracts to download from your history. Set to 0 to download all of them.
    _(Default: 0)_
-   `downloadMyContracts`: When set to true, this will download all contracts that you created. They will show up as Favorites, because Peacock shows all downloaded contracts in the My Contracts tab.
    _(Default: false)_
-   `downloadFavorites`: When set to true, this will download all contracts that you favorited. They will also show up both in the My Contracts tab and in the Favorites tab.
    _(Default: true)_
