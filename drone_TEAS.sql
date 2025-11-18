-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: db
-- Generation Time: Nov 18, 2025 at 10:14 AM
-- Server version: 8.0.44
-- PHP Version: 8.3.27

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `mydb`
--

-- --------------------------------------------------------

--
-- Table structure for table `drone_ours`
--

CREATE TABLE `drone_ours` (
  `id` int NOT NULL,
  `drone_id` varchar(50) NOT NULL,
  `latitude` double NOT NULL,
  `longitude` double NOT NULL,
  `altitude` double NOT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `drone_ours`
--

INSERT INTO `drone_ours` (`id`, `drone_id`, `latitude`, `longitude`, `altitude`, `detected_at`) VALUES
(1, 'OUR-001', 13.7563, 100.5018, 120, '2025-11-18 10:01:45'),
(2, 'OUR-002', 13.74, 100.52, 150, '2025-11-18 10:01:45'),
(3, 'OUR-003', 13.77, 100.51, 180, '2025-11-18 10:01:45');

-- --------------------------------------------------------

--
-- Table structure for table `drone_theirs`
--

CREATE TABLE `drone_theirs` (
  `id` int NOT NULL,
  `drone_id` varchar(50) NOT NULL,
  `confidence` double DEFAULT NULL,
  `latitude` double NOT NULL,
  `longitude` double NOT NULL,
  `altitude` double NOT NULL,
  `weather` varchar(50) DEFAULT NULL,
  `width` double DEFAULT NULL,
  `height` double DEFAULT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `drone_theirs`
--

INSERT INTO `drone_theirs` (`id`, `drone_id`, `confidence`, `latitude`, `longitude`, `altitude`, `weather`, `width`, `height`, `image_path`, `detected_at`) VALUES
(1, 'ENEMY-101', 0.92, 13.75505, 100.49291, 200, 'clear', 640, 480, '/uploads/theirs/1763040205274_bjywj6.jpg', '2025-11-18 10:07:44'),
(2, 'ENEMY-102', 0.85, 13.76, 100.51, 250, 'cloudy', 800, 600, '/uploads/theirs/1763084619557_1vke55.jpg', '2025-11-18 10:02:38'),
(3, 'ENEMY-103', 0.78, 13.745, 100.505, 180, 'rain', 1280, 720, '/uploads/theirs/enemy3.jpg', '2025-11-18 10:01:55');

-- --------------------------------------------------------

--
-- Table structure for table `red_zones`
--

CREATE TABLE `red_zones` (
  `id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `center_lat` double NOT NULL,
  `center_lng` double NOT NULL,
  `radius_meters` double NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('admin','user') DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `password_hash`, `role`, `created_at`) VALUES
(1, 'admin', '$2a$10$xyQJd4KXnkWOVhQeBptJPe0t7tacP9l72VhJ9SS.93sWMAYsVJrCS', 'admin', '2025-11-18 10:00:54');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `drone_ours`
--
ALTER TABLE `drone_ours`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `drone_id` (`drone_id`);

--
-- Indexes for table `drone_theirs`
--
ALTER TABLE `drone_theirs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `drone_id` (`drone_id`);

--
-- Indexes for table `red_zones`
--
ALTER TABLE `red_zones`
  ADD PRIMARY KEY (`id`),
  ADD KEY `created_by` (`created_by`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `drone_ours`
--
ALTER TABLE `drone_ours`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `drone_theirs`
--
ALTER TABLE `drone_theirs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `red_zones`
--
ALTER TABLE `red_zones`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `red_zones`
--
ALTER TABLE `red_zones`
  ADD CONSTRAINT `red_zones_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
