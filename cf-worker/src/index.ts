export interface Env {
	AI: Ai;
}

const models = {
	'stable-diffusion-xl-lightning': '@cf/bytedance/stable-diffusion-xl-lightning',
	'dreamshaper-8-lcm': '@cf/lykon/dreamshaper-8-lcm',
};

async function handleImageGeneration(request: Request, env: Env, modelIdentifier: any): Promise<Response> {
    try {
        const requestBody = await request.json<{ prompt: string }>();
        if (!requestBody || typeof requestBody.prompt !== 'string') {
            return new Response('Invalid request body: "prompt" field is required and must be a string.', { status: 400 });
        }

        const inputs = {
            prompt: requestBody.prompt,
        };

        const response = await env.AI.run(modelIdentifier, inputs);

        return new Response(response, {
            headers: {
                'content-type': 'image/png',
            },
        });
    } catch (e) {
        if (e instanceof SyntaxError) {
            return new Response('Invalid JSON in request body.', { status: 400 });
        }
        console.error(e);
        return new Response('Error processing request.', { status: 500 });
    }
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);

        if (request.method === 'POST') {
            if (pathname === '/generate/stable-diffusion-xl-lightning') {
                return handleImageGeneration(request, env, models['stable-diffusion-xl-lightning']);
            }

            if (pathname === '/generate/dreamshaper-8-lcm') {
                return handleImageGeneration(request, env, models['dreamshaper-8-lcm']);
            }
        }
		return new Response('Not found. Use POST /generate with a JSON body like {"prompt": "your image prompt"}', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
