import { readPackageJSON } from 'pkg-types'
import { getBorderCharacters, table } from 'table'

export async function getStartMessage() {
    const pkg = await readPackageJSON();

    return table([['Docs → https://docs.rw\nCommunity → https://t.me/remnawave']], {
        header: {
            content: `Ascella Subscription Page v${pkg.version}`,
            alignment: 'center',
        },
        columnDefault: {
            width: 60,
        },
        columns: {
            0: { alignment: 'center' },
            1: { alignment: 'center' },
        },
        drawVerticalLine: () => false,
        border: getBorderCharacters('ramac'),
    });
}
