import {Command} from '../domain/command';
import {CFToolsServer, CommandConfig} from '../domain/cftools';
import {CFToolsClient, LeaderboardItem, ServerApiId, Statistic} from 'cftools-sdk';
import {MessageEmbed} from 'discord.js';
import {translate} from '../translations';
import {secondsToHours} from '../seconds-to-hours';

const MAX_DISCORD_FIELD_SIZE = 1024;

interface Config extends CommandConfig {
    allowedStats: (keyof typeof statMapping)[],
    defaultStat: keyof typeof statMapping,
    numberOfPlayers: number,
}

interface Mapping {
    requestStatistic: Statistic,
    metricKey: string,
}

const statMapping: { [key: string]: Mapping } = {
    kills: {
        requestStatistic: Statistic.KILLS,
        metricKey: 'LEADERBOARD_KILLS',
    },
    deaths: {
        requestStatistic: Statistic.DEATHS,
        metricKey: 'LEADERBOARD_DEATHS',
    },
    suicides: {
        requestStatistic: Statistic.SUICIDES,
        metricKey: 'LEADERBOARD_SUICIDES',
    },
    playtime: {
        requestStatistic: Statistic.PLAYTIME,
        metricKey: 'LEADERBOARD_PLAYTIME',
    },
    longest_kill: {
        requestStatistic: Statistic.LONGEST_KILL,
        metricKey: 'LEADERBOARD_LONGEST_KILL',
    },
    longest_shot: {
        requestStatistic: Statistic.LONGEST_SHOT,
        metricKey: 'LEADERBOARD_LONGEST_SHOT',
    },
    kdratio: {
        requestStatistic: Statistic.KILL_DEATH_RATIO,
        metricKey: 'LEADERBOARD_KILL_DEATH_RATIO',
    },
}

function maxLength(items: LeaderboardItem[], label: string, valueFn: (item: LeaderboardItem) => string): number {
    const lengths = items.map((i) => valueFn(i).length);
    lengths.push(label.length);
    return lengths.sort((a, b) => b - a)[0];
}

function renderKillDeath(renderInline: boolean, items: LeaderboardItem[], message: MessageEmbed): MessageEmbed {
    const longestRank = maxLength(items, translate('LEADERBOARD_RANK'), (item) => item.rank.toString(10));
    const longestName = maxLength(items, translate('LEADERBOARD_NAME'), (item) => item.name);
    const longestKills = maxLength(items, translate('LEADERBOARD_KILLS'), (item) => item.kills.toString(10));
    const longestDeaths = maxLength(items, translate('LEADERBOARD_DEATHS'), (item) => item.deaths.toString(10));

    if (renderInline) {
        let text = '```' +
            translate('LEADERBOARD_RANK') + ' '.repeat(longestRank - translate('LEADERBOARD_RANK').length) + '\t' +
            translate('LEADERBOARD_NAME') + ' '.repeat(longestName - translate('LEADERBOARD_NAME').length) + '\t' +
            translate('LEADERBOARD_KILLS') + ' '.repeat(longestKills - translate('LEADERBOARD_KILLS').length) + '\t' +
            translate('LEADERBOARD_DEATHS') + ' '.repeat(longestDeaths - translate('LEADERBOARD_DEATHS').length) + '\n\n';
        for (let item of items) {
            const toAppend =
                ' '.repeat(longestRank - item.rank.toString(10).length) + item.rank + '\t' +
                item.name + ' '.repeat(longestName - item.name.length) + '\t' +
                item.kills + ' '.repeat(longestKills - item.kills.toString(10).length) + '\t' +
                item.deaths + ' '.repeat(longestDeaths - item.deaths.toString(10).length) + '\n';

            if (text.length + 6 + toAppend.length >= MAX_DISCORD_FIELD_SIZE) {
                text += '...';
                break;
            }
            text += toAppend;
        }
        text += '```';
        message.addField('\u200b', text);
    } else {
        for (let item of items) {
            message.addField(item.rank, item.name, true)
                .addField(translate('LEADERBOARD_KILLS'), item.kills, true)
                .addField(translate('LEADERBOARD_DEATHS'), item.deaths, true);
        }
    }
    return message;
}

function renderSingle(
    renderInline: boolean,
    items: LeaderboardItem[],
    message: MessageEmbed,
    titleKey: string,
    itemKey: keyof LeaderboardItem | ((item: LeaderboardItem) => string),
): MessageEmbed {
    let valueFn: (item: LeaderboardItem) => string;
    if (typeof itemKey === 'string') {
        valueFn = (item: LeaderboardItem) => item[itemKey] as string
    } else {
        valueFn = itemKey;
    }

    const longestRank = maxLength(items, translate('LEADERBOARD_RANK'), (item) => item.rank.toString(10));
    const longestName = maxLength(items, translate('LEADERBOARD_NAME'), (item) => item.name);
    const longestValue = maxLength(items, translate(titleKey), valueFn);

    if (renderInline) {
        let text = '```' +
            translate('LEADERBOARD_RANK') + ' '.repeat(longestRank - translate('LEADERBOARD_RANK').length) + '\t' +
            translate('LEADERBOARD_NAME') + ' '.repeat(longestName - translate('LEADERBOARD_NAME').length) + '\t\t' +
            translate(titleKey) + ' '.repeat(longestValue - translate(titleKey).length) + '\n\n';
        for (let item of items) {
            const toAppend =
                ' '.repeat(longestRank - item.rank.toString(10).length) + item.rank + '\t' +
                item.name + ' '.repeat(longestName - item.name.length) + '\t\t' +
                valueFn(item) + ' '.repeat(longestValue - valueFn(item).length) + '\n';

            if (text.length + 6 + toAppend.length >= MAX_DISCORD_FIELD_SIZE) {
                text += '...';
                break;
            }
            text += toAppend;
        }
        text += '```';
        message.addField('\u200b', text);
    } else {
        for (let item of items) {
            message.addField(item.rank, item.name, true)
                .addField('\u200b', '\u200b', true)
                .addField(translate(titleKey), valueFn(item), true);
        }
    }
    return message;
}

export class Leaderboard implements Command {
    public static readonly COMMAND = 'leaderboard';

    constructor(private readonly server: CFToolsServer, private readonly parameters: string[], private readonly config: Config) {
    }

    async execute(client: CFToolsClient, messageBuilder: MessageEmbed): Promise<string | MessageEmbed> {
        const stat = this.resolveCommand();
        if (typeof stat === 'string') {
            return stat;
        }
        const response = await client.getLeaderboard({
            serverApiId: ServerApiId.of(this.server.serverApiId),
            order: 'ASC',
            statistic: stat.requestStatistic,
            limit: this.config.numberOfPlayers,
        });

        const message = messageBuilder
            .setTitle(translate('LEADERBOARD_TITLE', {
                params: {
                    amount: this.config.numberOfPlayers.toString(10),
                    server: this.server.name,
                    metric: translate(stat.metricKey)
                }
            }));

        if (response.length === 0) {
            message.addField(translate('LEADERBOARD_EMPTY_TITLE'), translate('LEADERBOARD_EMPTY_BODY'));
            return message;
        } else {
            return this.renderLeaderboard(stat, response, message);
        }
    }

    private mustRenderInline(): boolean {
        return this.config.numberOfPlayers * 3 > 25;
    }

    private renderLeaderboard(stat: Mapping, response: LeaderboardItem[], message: MessageEmbed): MessageEmbed {
        switch (stat.requestStatistic) {
            case Statistic.KILLS:
            case Statistic.DEATHS:
                return renderKillDeath(this.mustRenderInline(), response, message);
            case Statistic.SUICIDES:
                return renderSingle(this.mustRenderInline(), response, message, 'LEADERBOARD_SUICIDES', 'suicides');
            case Statistic.PLAYTIME:
                return renderSingle(this.mustRenderInline(), response, message, 'LEADERBOARD_PLAYTIME', (item: LeaderboardItem) => secondsToHours(item.playtime));
            case Statistic.KILL_DEATH_RATIO:
                return renderSingle(this.mustRenderInline(), response, message, 'LEADERBOARD_KD_RATIO', 'killDeathRation');
            case Statistic.LONGEST_KILL:
                return renderSingle(this.mustRenderInline(), response, message, 'LEADERBOARD_LONGEST_KILL', (item: LeaderboardItem) => item.longestKill + 'm');
            case Statistic.LONGEST_SHOT:
                return renderSingle(this.mustRenderInline(), response, message, 'LEADERBOARD_LONGEST_SHOT', (item: LeaderboardItem) => item.longestShot + 'm');
            default:
                throw Error('Can not render unknown requested statistic.');
        }
    }

    private resolveCommand(): Mapping | string {
        let statCandidate = 'kills';
        if (this.parameters.length === 1) {
            statCandidate = this.parameters[0];
        }
        let key: string | undefined = undefined;
        if (!statMapping.hasOwnProperty(statCandidate)) {
            key = 'LEADERBOARD_STAT_NOT_KNOWN';
        } else if (!this.config.allowedStats.includes(statCandidate)) {
            key = 'LEADERBOARD_STAT_NOT_ALLOWED';
        }
        if (key !== undefined) {
            return translate(key, {
                params: {
                    allowedStats: this.config.allowedStats.join(', '),
                }
            });
        }
        return statMapping[statCandidate];
    }
}
