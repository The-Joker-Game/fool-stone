import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// @ts-ignore
import FOG from 'vanta/dist/vanta.fog.min';

interface VantaBackgroundProps {
    isNight: boolean;
}

// 1. 定义配置常量，方便管理
const CONFIG = {
    day: {
        highlightColor: 0xa0eafa,
        midtoneColor: 0xf56800,
        lowlightColor: 0xe0e6e2,
        baseColor: 0xffffff,
    },
    night: {
        highlightColor: 0xb0b0b0,
        midtoneColor: 0x454545,
        lowlightColor: 0x1c1c1c,
        baseColor: 0x000000,
    }
};

export function VantaBackground({ isNight }: VantaBackgroundProps) {
    const vantaRef = useRef<HTMLDivElement>(null);
    const [vantaEffect, setVantaEffect] = useState<any>(null);

    // 用来存储动画帧ID，以便在组件卸载或快速切换时取消上一帧动画
    const requestRef = useRef<number | undefined>(undefined);

    // 用来记录"当前"正在显示的颜色状态，用于从任意状态开始过渡
    const currentColors = useRef({ ...CONFIG.day });

    // 初始化 Vanta
    useEffect(() => {
        if (!vantaEffect && vantaRef.current) {
            try {
                const effect = FOG({
                    el: vantaRef.current,
                    THREE: THREE,
                    mouseControls: false,
                    touchControls: false,
                    gyroControls: false,
                    minHeight: 200.00,
                    minWidth: 200.00,
                    speed: 2.00,
                    zoom: 0.40,
                    // 初始颜色使用当前的 props
                    ... (isNight ? CONFIG.night : CONFIG.day)
                });
                if (effect.renderer) {
                    effect.renderer.setPixelRatio(1);
                }
                // 初始化时同步 ref 状态
                currentColors.current = isNight ? { ...CONFIG.night } : { ...CONFIG.day };
                setVantaEffect(effect);
            } catch (error) {
                console.error("Failed to initialize Vanta effect:", error);
            }
        }
        return () => {
            if (vantaEffect) {
                vantaEffect.destroy();
                setVantaEffect(null);
            }
            // 清理动画帧
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    // 监听 isNight 变化，执行过渡动画
    useEffect(() => {
        if (!vantaEffect) return;

        const targetConfig = isNight ? CONFIG.night : CONFIG.day;

        // 动画起始时间
        let startTime: number | null = null;
        const duration = 1500; // 过渡时间：1.5秒

        // 捕获动画开始时的颜色快照（作为起点）
        const startColorsSnapshot = { ...currentColors.current };

        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;

            // 计算进度 0.0 到 1.0
            // Math.min 确保不溢出 1
            const progress = Math.min(elapsed / duration, 1);

            // 使用简单的缓动函数 (Ease In Out) 让动画更自然
            // 公式：t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t
            const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;

            // 计算当前帧的颜色
            const newOptions: any = {};
            const keys = ['highlightColor', 'midtoneColor', 'lowlightColor', 'baseColor'] as const;

            keys.forEach(key => {
                const startColor = new THREE.Color(startColorsSnapshot[key]);
                const endColor = new THREE.Color(targetConfig[key]);

                // THREE.Color.lerp 会直接修改 startColor 实例，计算中间色
                // lerp(target, alpha)
                const currentColor = startColor.lerp(endColor, ease);

                // 获取十六进制整数值 (e.g., 0xffffff)
                const hexValue = currentColor.getHex();

                newOptions[key] = hexValue;
                // 更新 ref 记录，以防动画中途被打断
                currentColors.current[key] = hexValue;
            });

            // 应用到 Vanta
            vantaEffect.setOptions(newOptions);

            if (progress < 1) {
                requestRef.current = requestAnimationFrame(animate);
            }
        };

        // 取消之前的动画（如果在运行中）并开始新的
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        requestRef.current = requestAnimationFrame(animate);

    }, [isNight, vantaEffect]);

    return <div ref={vantaRef} className="fixed inset-0 -z-10" />;
}