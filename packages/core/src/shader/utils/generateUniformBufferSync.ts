import type { Dict } from '@pixi/utils';

import { IUniformData } from '../Program';
import { UniformBufferGroup } from '../UniformBufferGroup';

export type UniformsSyncCallback = (...args: any[]) => void;

// cv = CachedValue
// v = value
// ud = uniformData
// uv = uniformValue
// l = location
const UBO_TO_SINGLE_SETTERS_CACHED: Dict<string> = {
    float: `
        data[offset] = v;
    `,
    vec2: `
        data[offset] = v[0];
        data[offset+1] = v[1];
    `,
    vec3: `
        data[offset] = v[0];
        data[offset+1] = v[1];
        data[offset+2] = v[2];
        
    `,
    vec4: `
        data[offset] = v[0];
        data[offset+1] = v[1];
        data[offset+2] = v[2];
        data[offset+3] = v[3];
    `,
    mat2: `
        for(var i = 0; i < 4; i++)
        {
            data[offset + i] = v[i];
        }
    `,
    mat3: `
        for(var i = 0; i < 9; i++)
        {
            data[offset + i] = v[i];
        }
    `,
    mat4: `
        for(var i = 0; i < 16; i++)
        {
            data[offset + i] = v[i];
        }
    `
};

const GLSL_TO_STD40_SIZE: Dict<number> = {
    float:  4,
    vec2:   8,
    vec3:   16,
    vec4:   16,

    int:      4,
    ivec2:    8,
    ivec3:    16,
    ivec4:    16,

    uint:     4,
    uvec2:    8,
    uvec3:    16,
    uvec4:    16,

    bool:     4,
    bvec2:    8,
    bvec3:    16,
    bvec4:    16,

    mat2:     16 * 2,
    mat3:     16 * 3,
    mat4:     16 * 4,

    sampler2D:  4,
};

interface UBOElement {
    data:IUniformData
    offset:number,
    dataLen:number,
    chunkLen:number
    dirty:number
}

/**
 *
 * logic originally from here: https://github.com/sketchpunk/FunWithWebGL2/blob/master/lesson_022/Shaders.js
 *
 * @param uniformData
 */
function createUBOElements(uniformData:IUniformData[]):{uboElements:UBOElement[], size:number}
{
    const uboElements:UBOElement[] = uniformData.map((data:IUniformData) =>
        ({
            data,
            offset: 0,
            dataLen: 0,
            chunkLen: 0,
            dirty: 0
        }));

    let chunk = 16;	// Data size in Bytes, UBO using layout std140 needs to build out the struct in chunks of 16 bytes.
    let remainingChunk = 0;	// Temp Size, How much of the chunk is available after removing the data size from it
    let offset = 0;	// Offset in the buffer allocation
    let size = 0;	// Data Size of the current type

    for (let i = 0; i < uboElements.length; i++)
    {
        size = GLSL_TO_STD40_SIZE[uboElements[i].data.type];

        remainingChunk = chunk - size;	// How much of the chunk exists after taking the size of the data.

        // Chunk has been overdrawn when it already has some data reserved for it.
        if (remainingChunk < 0 && chunk < 16)
        {
            offset += chunk;						// Add Remaining Chunk to offset...
            if (i > 0) uboElements[i - 1].chunkLen += chunk;	// So the remaining chunk can be used by the last variable
            chunk = 16;								// Reset Chunk
        }
        else if (remainingChunk < 0 && chunk === 16)
        {
            // Do nothing in case data length is >= to unused chunk size.
            // Do not want to change the chunk size at all when this happens.
        }
        else if (remainingChunk === 0)
        {
            chunk = 16;				// If evenly closes out the chunk, reset
        }
        else
        {
            chunk -= size;	// Chunk isn't filled, just remove a piece
        }

        // Add some data of how the chunk will exist in the buffer.

        uboElements[i].offset = offset;
        uboElements[i].chunkLen = size;
        uboElements[i].dataLen = size;

        offset += size;
    }

    // Check if the final offset is divisible by 16, if not add remaining chunk space to last element.
    if (offset % 16 !== 0)
    {
        uboElements[uboElements.length - 1].chunkLen += chunk;
        offset += chunk;
    }

    return { uboElements, size: offset };
}

export function generateUniformBufferSync(group: UniformBufferGroup, uniformData: Dict<any>): UniformsSyncCallback
{
    const usedUniformDatas = [];

    // build..
    for (const i in group.uniforms)
    {
        if (uniformData[i])
        {
            usedUniformDatas.push(uniformData[i]);
        }
    }

    usedUniformDatas.sort((a, b) => a.index - b.index);

    const { uboElements, size } = createUBOElements(usedUniformDatas);

    const data = new Float32Array(size / 4);

    group.buffer.update(data);

    const funcFragments = [`
    var v = null;
    var cv = null
    var t = 0;
    var gl = renderer.gl
    var index = 0;
    var data = buffer.data;
    `];

    for (let i = 0; i < uboElements.length; i++)
    {
        const uboElement = uboElements[i];
        const name = uboElement.data.name;

        if (uboElement.data.size !== 1)
        {
            throw new Error('UBO arrays not supported yet');
        }

        const template = UBO_TO_SINGLE_SETTERS_CACHED[uboElement.data.type];

        funcFragments.push(`
            cv = ud.${name}.value;
            v = uv.${name};
            offset = ${uboElement.offset / 4};
            ${template};
        `);
    }

    funcFragments.push(`
       renderer.buffer.update(buffer);
    `);

    // eslint-disable-next-line no-new-func
    return new Function('ud', 'uv', 'renderer', 'syncData', 'buffer', funcFragments.join('\n')) as UniformsSyncCallback;
}
