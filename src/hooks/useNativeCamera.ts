import { useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface CameraPhoto {
  dataUrl: string;
  file?: File;
  format: string;
  /** Present on device even when the data URL has had its EXIF segment stripped. */
  exif?: unknown;
}

// Lazy load the camera plugin only when needed
const getCameraPlugin = async () => {
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    return { Camera, CameraResultType, CameraSource };
  } catch (error) {
    console.log('Camera plugin not available:', error);
    return null;
  }
};

export function useNativeCamera() {
  const [isLoading, setIsLoading] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const takePicture = async (source: 'camera' | 'photos' = 'camera'): Promise<CameraPhoto | null> => {
    setIsLoading(true);
    
    try {
      const cameraModule = await getCameraPlugin();
      if (!cameraModule) {
        console.log('Camera plugin not loaded');
        return null;
      }

      const { Camera, CameraResultType, CameraSource } = cameraModule;

      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        correctOrientation: true,
        width: 1920,
        height: 1920,
      });

      if (!image.dataUrl) {
        return null;
      }

      // Convert data URL to File for upload
      const file = await dataUrlToFile(image.dataUrl, `photo_${Date.now()}.${image.format}`);

      return {
        dataUrl: image.dataUrl,
        file,
        format: image.format || 'jpeg',
        exif: image.exif,
      };
    } catch (error) {
      console.error('Error taking picture:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const pickFromGallery = async (): Promise<CameraPhoto | null> => {
    return takePicture('photos');
  };

  const checkPermissions = async (): Promise<boolean> => {
    try {
      const cameraModule = await getCameraPlugin();
      if (!cameraModule) return false;

      const { Camera } = cameraModule;
      const permissions = await Camera.checkPermissions();
      
      if (permissions.camera !== 'granted' || permissions.photos !== 'granted') {
        const requested = await Camera.requestPermissions();
        return requested.camera === 'granted';
      }
      
      return true;
    } catch (error) {
      console.error('Error checking camera permissions:', error);
      return false;
    }
  };

  return {
    isNative,
    isLoading,
    takePicture,
    pickFromGallery,
    checkPermissions,
  };
}

// Helper function to convert data URL to File
async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}
