// ====================================================================================================
//
// Cloud Code for SERVICE_BATTLE, write your code here to customize the GameSparks platform.
//
// For details of the GameSparks Cloud Code API see https://docs.gamesparks.com/
//
// ====================================================================================================
// MIT License
// Copyright (c) 2018 Ittipon Teerapruettikulchai
// ====================================================================================================
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// ====================================================================================================
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// ====================================================================================================
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ====================================================================================================

var API = Spark.getGameDataService();
var colPlayerItem = "playerItem";
var colPlayerStamina = "playerStamina";
var colPlayerFormation = "playerFormation";
var colPlayerUnlockItem = "playerUnlockItem";
var colPlayerClearStage = "playerClearStage";
var colPlayerBattle = "playerBattle";

function StartStage(stageDataId)
{
    var player = Spark.getPlayer();
    var playerId = player.getPlayerId();
    var queryResult = API.queryItems(
        colPlayerBattle, 
        API.S("playerId").eq(playerId).and(API.N("battleResult").eq(ENUM_BATTLE_RESULT_NONE)),
        API.sort("id", false));
    var result = queryResult.cursor();
    while (result.hasNext())
    {
        result.next().delete();
    }
    var stage = gameDatabase.stages[stageDataId];
    if (!stage)
    {
        Spark.setScriptData("error", ERROR_INVALID_STAGE_DATA);
    }
    else if (!DecreasePlayerStamina(playerId, "STAGE", stage.requireStamina))
    {
        Spark.setScriptData("error", ERROR_NOT_ENOUGH_STAGE_STAMINA);
    }
    else
    {
        var session = playerId + "_" + stageDataId + "_" + Date.now();
        var newData = CreatePlayerBattle(playerId, stageDataId, session);
        var id = newData.id;
        var newEntry = API.createItem(colPlayerBattle, id);
        newEntry.setData(newData);
        newEntry.persistor().persist().error();
        var staminaTable = gameDatabase.staminas["STAGE"];
        var stamina = GetStamina(playerId, staminaTable.id);
        Spark.setScriptData("stamina", stamina);
        Spark.setScriptData("session", session);
    }
}

function FinishStage(session, battleResult, deadCharacters)
{
    var player = Spark.getPlayer();
    var playerId = player.getPlayerId();
    var queryResult = API.queryItems(
        colPlayerBattle, 
        API.S("playerId").eq(playerId).and(API.S("session").eq(session)),
        API.sort("id", false));
    var result = queryResult.cursor();
    if (!result.hasNext())
    {
        Spark.setScriptData("error", ERROR_INVALID_BATTLE_SESSION);
    }
    else
    {
        var battleEntry = result.next();
        var battle = battleEntry.getData();
        if (!gameDatabase.stages[battle.dataId])
        {
            Spark.setScriptData("error", ERROR_INVALID_STAGE_DATA);
        }
        else
        {
            // Prepare results
            var rewardItems = [];
            var createItems = [];
            var updateItems = [];
            var deleteItemIds = [];
            var updateCurrencies = [];
            var rewardPlayerExp = 0;
            var rewardCharacterExp = 0;
            var rewardSoftCurrency = 0;
            var rating = 0;
            var clearedStage = {};
            // Set battle session
            battle.battleResult = battleResult;
            if (battleResult == ENUM_BATTLE_RESULT_WIN)
            {
                rating = 3 - deadCharacters;
                if (rating <= 0)
                    rating = 1;
            }
            battle.rating = rating;
            battleEntry.setData(battle);
            battleEntry.persistor().persist().error();
            if (battleResult == ENUM_BATTLE_RESULT_WIN)
            {
                var playerSelectedFormation = player.getScriptData("selectedFormation");
                var stage = gameDatabase.stages[battle.dataId];
                rewardPlayerExp = stage.rewardPlayerExp;
                // Player exp
                var playerExp = player.getScriptData("exp");
                playerExp += rewardPlayerExp;
                player.setScriptData("exp", playerExp);
                // Character exp
                var characterIds = GetFormationCharacterIds(playerId, playerSelectedFormation);
                if (characterIds.length > 0)
                {
                    var devivedExp = Math.floor(stage.rewardCharacterExp / characterIds.length);
                    rewardCharacterExp = devivedExp;
                    var countCharacterIds = characterIds.length;
                    for (var i = 0; i < countCharacterIds; ++i)
                    {
                        var characterId = characterIds[i];
                        var characterQueryResult = API.getItem(colPlayerItem, characterId);
                        var characterEntry = characterQueryResult.document();
                        if (characterEntry)
                        {
                            var character = characterEntry.getData();
                            character.exp += devivedExp;
                            characterEntry.setData(character);
                            characterEntry.persistor().persist().error();
                            updateItems.push(character);
                        }
                    }
                }
                // Soft currency
                rewardSoftCurrency = RandomRange(stage.randomSoftCurrencyMinAmount, stage.randomSoftCurrencyMaxAmount);
                player.credit(gameDatabase.currencies.SOFT_CURRENCY, rewardSoftCurrency, "Pass Stage [" + session + "]");
                var softCurrency = GetCurrency(playerId, gameDatabase.currencies.SOFT_CURRENCY);
                updateCurrencies.push(softCurrency);
                // Items
                var countRewardItems = stage.rewardItems.length;
                for (var i = 0; i < countRewardItems; ++i)
                {
                    var rewardItem = stage.rewardItems[i];
                    if (!rewardItem || !rewardItem.id || RandomRange(0, 1) > rewardItem.randomRate)
                    {
                        continue;
                    }
                        
                    var addItemsResult = AddItems(playerId, rewardItem.id, rewardItem.amount);
                    if (addItemsResult.success)
                    {
                        var countCreateItems = addItemsResult.createItems.length;
                        var countUpdateItems = addItemsResult.updateItems.length;
                        for (var j = 0; j < countCreateItems; ++j)
                        {
                            var createItem = addItemsResult.createItems[j];
                            var newItemId = createItem.id;
                            var newItemEntry = API.createItem(colPlayerItem, newItemId);
                            newItemEntry.setData(createItem);
                            newItemEntry.persistor().persist().error();
                            HelperUnlockItem(playerId, createItem.dataId);
                            rewardItems.push(createItem);
                            createItems.push(createItem);
                        }
                        for (var j = 0; j < countUpdateItems; ++j)
                        {
                            var updateItem = addItemsResult.updateItem[j];
                            var updateItemResult = API.getItem(colPlayerItem, updateItem.id);
                            var updateItemEntry = updateItemResult.document();
                            updateItemEntry.setData(updateItem);
                            updateItemEntry.persistor().persist().error();
                            rewardItems.push(updateItem);
                            updateItems.push(updateItem);
                        }
                    }
                    // End add item condition
                }
                // End reward items loop
                
                clearedStage = HelperClearStage(playerId, stage.id, rating);
            }
            Spark.setScriptData("rewardItems", rewardItems);
            Spark.setScriptData("createItems", createItems);
            Spark.setScriptData("updateItems", updateItems);
            Spark.setScriptData("deleteItemIds", deleteItemIds);
            Spark.setScriptData("updateCurrencies", updateCurrencies);
            Spark.setScriptData("rewardPlayerExp", rewardPlayerExp);
            Spark.setScriptData("rewardCharacterExp", rewardCharacterExp);
            Spark.setScriptData("rewardSoftCurrency", rewardSoftCurrency);
            Spark.setScriptData("rating", rating);
            Spark.setScriptData("clearStage", clearedStage);
            Spark.setScriptData("player", GetPlayer(playerId));
        }
    }
}

function ReviveCharacters()
{
    var player = Spark.getPlayer();
    var playerId = player.getPlayerId();
    var hardCurrencyId = gameDatabase.currencies.HARD_CURRENCY;
    var revivePrice = gameDatabase.revivePrice;
    if (revivePrice > player.getBalance(hardCurrencyId))
    {
        Spark.setScriptData("error", ERROR_NOT_ENOUGH_HARD_CURRENCY);
    }
    else
    {
        player.debit(hardCurrencyId, revivePrice, "Revive Characters");
        var hardCurrency = GetCurrency(playerId, hardCurrencyId);
        var updateCurrencies = [];
        updateCurrencies.push(hardCurrency);
        Spark.setScriptData("updateCurrencies", updateCurrencies);
    }
}

function SelectFormation(formationName)
{
    var player = Spark.getPlayer();
    var playerId = player.getPlayerId();
    var indexOfFormation = gameDatabase.formations.indexOf(formationName);
    if (indexOfFormation === -1)
    {
        Spark.setScriptData("error", ERROR_INVALID_FORMATION_DATA);
    }
    else
    {
        player.setScriptData("selectedFormation", formationName);
        Spark.setScriptData("player", GetPlayer(playerId));
    }
}

function SetFormation(characterId, formationName, position)
{
    var player = Spark.getPlayer();
    var playerId = player.getPlayerId();
    
    var formations = HelperSetFormation(playerId, characterId, formationName, position);
    
    var list = [];
    var queryResult = API.queryItems(colPlayerFormation, API.S("playerId").eq(playerId), API.sort("timestamp", false));
    if (!queryResult.error())
    {
        var result = queryResult.cursor();
        while (result.hasNext())
        {
            var entry = result.next();
            list.push(entry.getData());
        }
    }
    if (formations.newFormation)
    {
        list.push(formations.newFormation);
    }
    Spark.setScriptData("list", list);
}
