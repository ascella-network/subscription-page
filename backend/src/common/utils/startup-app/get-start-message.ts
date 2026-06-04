import { getBorderCharacters, table } from 'table';
import { readPackageJSON } from 'pkg-types';

export async function getStartMessage(port: number | string) {
    const pkg = await readPackageJSON();

    const portLine = `Listening on → http://127.0.0.1:${port}`;

    return table([[`Docs → https://docs.rw\nCommunity → https://t.me/remnawave\n${portLine}`]], {
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
