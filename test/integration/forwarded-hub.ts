import { createServer, connect, type Socket } from 'node:net';

/** A TCP tunnel preserves the browser's Host and Origin while reaching another port. */
export async function forwardedHub(target: string, cleanups: (() => void | Promise<void>)[]) {
    const destination = new URL(target), sockets = new Set<Socket>();
    const track = (socket: Socket) => {
        sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket;
    };
    const server = createServer(client => {
        const upstream = track(connect({ host: destination.hostname, port: Number(destination.port) }));
        track(client);
        client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
        client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
        client.pipe(upstream); upstream.pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    cleanups.push(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    const url = `http://localhost:${(server.address() as { port: number }).port}`;
    return { url, link(value: string) {
        const original = new URL(value), entry = new URL(url);
        original.protocol = entry.protocol; original.host = entry.host; return original.href;
    } };
}
