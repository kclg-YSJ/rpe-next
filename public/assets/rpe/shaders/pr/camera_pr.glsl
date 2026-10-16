#version 100
precision mediump float;

varying vec2 uv; // 材质 UV，替换v_texCoord
uniform vec2 screenSize; // 屏幕大小resolution
uniform sampler2D screenTexture; // 屏幕材质，替换u_texture和CC_Texture0
uniform float time; // 时间，以秒为单位，替换u_time

// 控制变量：缩放倍率、中心偏移、旋转角度
uniform float zoom; // %1.0%
uniform vec2 offset; // %0.0, 0.0%
uniform float rotation; // %0.0%

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);

void main()
{
    vec2 centeredCoord = uv - vec2(0.5, 0.5);
    float scale = screenSize.y / screenSize.x;
    centeredCoord.x = centeredCoord.x / scale;

    centeredCoord /= zoom;

    float sinAngle = sin(rotation * 3.1415926 / 180.0);
    float cosAngle = cos(rotation * 3.1415926 / 180.0);
    vec2 rotatedCoord = vec2(
        cosAngle * centeredCoord.x - sinAngle * centeredCoord.y,
        sinAngle * centeredCoord.x + cosAngle * centeredCoord.y
    );
    
    rotatedCoord.x = rotatedCoord.x * scale;

    rotatedCoord = rotatedCoord - offset + vec2(0.5, 0.5);
	
	if (rotatedCoord.x >= rectMin.x && rotatedCoord.x <= rectMax.x && rotatedCoord.y >= rectMin.y && rotatedCoord.y <= rectMax.y) 
	{
		gl_FragColor = texture2D(screenTexture, rotatedCoord);
		gl_FragColor.a = 1.0;
	}
	else
	{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}
