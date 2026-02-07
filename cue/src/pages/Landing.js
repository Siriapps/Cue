import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform, useInView, AnimatePresence } from 'framer-motion';
import './Landing.css';

import gmailImg from '../assets/gmail integration.jpg';
import meetingDashboardImg from '../assets/meeting dashboard.jpg';
import predictionImg from '../assets/prediction.jpg';
import sessionDetailsImg from '../assets/session details.jpg';
import taskAutomationImg from '../assets/task automation.jpg';
import shinyBg from '../shiny bg.jpg';
import swirlBg from '../swirl bg.jpg';
import cueLogo from '../logo.png';

const CAROUSEL_IMAGES = [gmailImg, meetingDashboardImg, predictionImg, sessionDetailsImg, taskAutomationImg];

/* Repeated for gallery background - many small strip tiles, full width grid */
const GALLERY_BG_IMAGES = Array.from({ length: 64 }, (_, i) => CAROUSEL_IMAGES[i % CAROUSEL_IMAGES.length]);

// Typing animation component
function TypeWriter({ texts, speed = 50, deleteSpeed = 30, pauseTime = 2000 }) {
  const [displayText, setDisplayText] = useState('');
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentText = texts[textIndex];

    const timer = setTimeout(() => {
      if (!isDeleting) {
        if (displayText.length < currentText.length) {
          setDisplayText(currentText.slice(0, displayText.length + 1));
        } else {
          setTimeout(() => setIsDeleting(true), pauseTime);
        }
      } else {
        if (displayText.length > 0) {
          setDisplayText(displayText.slice(0, -1));
        } else {
          setIsDeleting(false);
          setTextIndex((prev) => (prev + 1) % texts.length);
        }
      }
    }, isDeleting ? deleteSpeed : speed);

    return () => clearTimeout(timer);
  }, [displayText, isDeleting, textIndex, texts, speed, deleteSpeed, pauseTime]);

  return (
    <span className="typewriter">
      {displayText}
      <span className="typewriter-cursor">|</span>
    </span>
  );
}

// Feature card component
function FeatureCard({ icon, title, description, delay = 0 }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <motion.div
      ref={ref}
      className="feature-card"
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="feature-icon">{icon}</div>
      <h3 className="feature-title">{title}</h3>
      <p className="feature-description">{description}</p>
    </motion.div>
  );
}

function Landing() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: containerRef });

  // Parallax transforms
  const sphereY = useTransform(scrollYProgress, [0, 0.5], [0, -100]);
  const sphereScale = useTransform(scrollYProgress, [0, 0.3], [1, 0.8]);
  const sphereOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0.3]);

  const [currentSlide, setCurrentSlide] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % CAROUSEL_IMAGES.length);
    }, 20000);
    return () => clearInterval(id);
  }, []);

  const handleGetStarted = () => {
    navigate('/login');
  };

  const commandExamples = [
    '@gmail draft email to team about project update',
    '@calendar create meeting tomorrow at 3pm',
    '@tasks add "Review quarterly report" due Friday',
    '@docs create "Meeting Notes" for standup',
    '@drive find files about "Q4 Budget"',
  ];

  return (
    <div className="landing-page" ref={containerRef}>
      {/* Background ambient elements */}
      <div className="landing-ambient" />

      {/* Navigation */}
      <nav className="landing-nav">
        <div className="landing-brand">
          <div className="landing-logo">
            <img src={cueLogo} alt="cue" className="cue-logo-img" />
          </div>
          <span className="landing-brand-text">cue</span>
        </div>
        <ul className="landing-nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="#demo">Demo</a></li>
          <li><a href="#about">About</a></li>
          <li>
            <button type="button" className="landing-cta-nav" onClick={handleGetStarted}>
              Get Started
            </button>
          </li>
        </ul>
      </nav>

      {/* Hero Section */}
      <main className="landing-hero">
        {/* Luminous colored dots around sphere */}
        <div className="sphere-dots" aria-hidden="true">
          <span className="sphere-dot dot-purple" />
          <span className="sphere-dot dot-blue" />
          <span className="sphere-dot dot-pink" />
          <span className="sphere-dot dot-purple-2" />
          <span className="sphere-dot dot-blue-2" />
          <span className="sphere-dot dot-pink-2" />
        </div>
        <motion.div
          className="landing-hero-sphere-wrap"
          style={{ y: sphereY, scale: sphereScale, opacity: sphereOpacity }}
          aria-hidden="true"
        >
          <div className="landing-hero-sphere" />
          {shinyBg && (
            <img
              src={shinyBg}
              alt=""
              className="landing-hero-sphere-shiny"
            />
          )}
        </motion.div>
        <motion.div
          className="landing-hero-content"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <span className="landing-tagline">AI-Powered Workspace</span>
          <h1 className="landing-headline">Your Personal AI Agent</h1>
          <p className="landing-subtitle">Real control. Real actions. Real speed.</p>
          <motion.button
            type="button"
            className="landing-cta"
            onClick={handleGetStarted}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Get Started
          </motion.button>
        </motion.div>
      </main>

      {/* Features Section - Carousel (central device frame + diagonal background) */}
      <section className="landing-section landing-section-carousel" id="features">
        <motion.div
          className="section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="section-title section-title-luminous">Your Command Center</h2>
          <p className="section-subtitle section-subtitle-glow">One interface. Infinite possibilities.</p>
        </motion.div>

        <div className="landing-features-carousel-wrap">
          {/* Gallery background - strip moves in a vertical cycle, fades at top/bottom */}
          <div className="landing-diagonal-bg landing-carousel-bg-gallery" aria-hidden="true">
            <motion.div
              className="landing-carousel-bg-strip"
              animate={{ y: ['0%', '-50%'] }}
              transition={{
                duration: 24,
                repeat: Infinity,
                repeatType: 'loop',
                ease: 'linear',
              }}
            >
              {GALLERY_BG_IMAGES.map((src, i) => (
                <div
                  key={`gallery-bg-${i}`}
                  className="landing-diagonal-bg-item gallery-tile"
                  style={{ backgroundImage: `url(${src})` }}
                />
              ))}
            </motion.div>
          </div>
          {/* Central device-framed carousel - overlays on top, one slide at a time, auto 20s */}
          <div className="landing-hero-carousel landing-carousel-device" aria-hidden="true">
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={currentSlide}
                src={CAROUSEL_IMAGES[currentSlide]}
                alt=""
                className="landing-hero-carousel-slide"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
              />
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section className="landing-section landing-demo-section" id="demo">
        {swirlBg && (
          <div
            className="landing-demo-section-bg"
            style={{ backgroundImage: `url(${swirlBg})` }}
            aria-hidden="true"
          />
        )}
        <motion.div
          className="section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="section-title">See it in action</h2>
        </motion.div>

        <motion.div
          className="demo-terminal"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="terminal-header">
            <div className="terminal-dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="terminal-title">cue - AI Workspace</span>
          </div>
          <div className="terminal-body">
            <div className="terminal-prompt">
              <span className="prompt-symbol">&gt;</span>
              <TypeWriter texts={commandExamples} speed={60} deleteSpeed={20} pauseTime={2500} />
            </div>
          </div>
        </motion.div>
      </section>

      {/* About Section */}
      <section className="landing-section" id="about">
        <motion.div
          className="about-content"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="section-title">Built for the future</h2>
          <p className="about-text">
            cue is an intelligent workspace assistant powered by Gemini AI.
            Record meetings, get instant transcriptions, AI-generated summaries,
            and seamlessly manage your Google Workspace with natural language commands.
          </p>
          <motion.button
            type="button"
            className="landing-cta"
            onClick={handleGetStarted}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Start Using cue
          </motion.button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <img src={cueLogo} alt="cue" className="cue-logo-img" />
            <span>cue</span>
          </div>
          <p className="footer-text">Powered by Gemini AI</p>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
