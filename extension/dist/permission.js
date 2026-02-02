document.getElementById('request').onclick = async () => {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        document.getElementById('request').style.display = 'none';
        document.getElementById('success').style.display = 'block';
        document.getElementById('success').textContent = 'Permission Granted! Closing...';

        // Notify background to retry wake word
        chrome.runtime.sendMessage({ type: 'PERMISSION_GRANTED' });

        setTimeout(() => {
            window.close();
        }, 1500);
    } catch (error) {
        console.error('Permission denied:', error);
        alert('Permission was denied. Please allow microphone access in your browser settings for this extension.');
    }
};
